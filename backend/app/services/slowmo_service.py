"""Smooth slow motion: new frames made between the clip's own, so a 30 fps clip plays at ½, ¼ or ⅛ speed without
stutter (like optical-flow slow motion in pro tools). How every pixel moves between two frames is measured once
(OpenCV's DIS optical flow, on a half-size copy); each new frame slides both neighbours part of the way along that
motion and blends them. The result is a silent video of the clip's part, slowed, that plays and exports like any clip.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.cutout_service import colour
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

VERSION = 1
FACTORS = (2, 4, 8)


def target_path(source: Path, start: float, end: float, factor: int) -> Path:
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), factor])
    return settings.data_dir / 'media' / f'slowmo-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


class Between:
    """Makes the frames between two: the motion each way, measured on half-size grey copies."""

    def __init__(self):
        import cv2
        self.cv2 = cv2
        self.flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_FAST)
        self.grid = None

    def frames(self, a: np.ndarray, b: np.ndarray, count: int) -> list[np.ndarray]:
        """`count` frames evenly between a and b (not a or b themselves)."""
        cv2 = self.cv2
        height, width = a.shape[:2]
        half = (max(16, width // 2), max(16, height // 2))
        ga = cv2.cvtColor(cv2.resize(a, half, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        gb = cv2.cvtColor(cv2.resize(b, half, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        forward = cv2.resize(self.flow.calc(ga, gb, None), (width, height), interpolation=cv2.INTER_LINEAR) * 2
        backward = cv2.resize(self.flow.calc(gb, ga, None), (width, height), interpolation=cv2.INTER_LINEAR) * 2
        if self.grid is None or self.grid[0].shape != (height, width):
            xs, ys = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
            self.grid = (xs, ys)
        xs, ys = self.grid
        out = []
        for k in range(1, count + 1):
            t = k / (count + 1)
            # Each new frame looks back along the motion into a and forward into b, then blends by nearness in time.
            from_a = cv2.remap(a, xs - t * forward[..., 0], ys - t * forward[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            from_b = cv2.remap(b, xs - (1 - t) * backward[..., 0], ys - (1 - t) * backward[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            out.append(cv2.addWeighted(from_a, 1 - t, from_b, t, 0))
        return out


def make(facts: MediaFacts, start: float, end: float, factor: int, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The part start..end (source seconds) played `factor` times slower, smoothly, at the clip's own frame rate."""
    if factor not in FACTORS:
        raise ValueError('Choose half, a quarter or an eighth speed.')
    target = target_path(facts.path, start, end, factor)
    if target.is_file():
        return target
    width, height = facts.width or 1920, facts.height or 1080
    width, height = width - width % 2, height - height % 2
    fps = facts.fps or 30
    total = max(1, round((end - start) * fps))
    ffmpeg = shutil.which('ffmpeg')
    read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', str(facts.path), '-an',
                             '-vf', f'{colour(facts)},scale={width}:{height}', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    write = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                              '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    between = Between()
    try:
        assert read.stdout and write.stdin
        size, done, last = width * height * 3, 0, None
        while chunk := read.stdout.read(size):
            if should_cancel():
                raise JobCancelled()
            if len(chunk) < size:
                break
            frame = np.frombuffer(chunk, np.uint8).reshape(height, width, 3)
            if last is not None:
                for made in between.frames(last, frame, factor - 1):
                    write.stdin.write(made.tobytes())
            write.stdin.write(frame.tobytes())
            last, done = frame, done + 1
            if done % 5 == 0:
                on_progress(min(98, done * 98 // total))
        if last is not None:  # The last frame holds for its share of time.
            for _ in range(factor - 1):
                write.stdin.write(last.tobytes())
        write.stdin.close()
        if write.wait() or done == 0:
            raise RuntimeError('Could not make the slow motion.')
        temporary.replace(target)
    finally:
        for process in (read, write):
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
    on_progress(100)
    return target
