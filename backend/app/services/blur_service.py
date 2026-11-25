"""Real motion blur: the smear a film camera's shutter gives moving things, instead of crisp, stuttering frames. How every
pixel moves is measured around each frame (OpenCV's DIS optical flow on half-size copies, into the next frame and from
the one before, so the blur is centred on the movement); each pixel is then smeared along its own movement by the
shutter's share of it: 180° (half a frame's movement, the classic cinema look), 360° (all of it, dreamy) or 90°
(crisp action). Still parts stay sharp. The result is a new video of the clip's part (with its sound), and the original
is kept to go back to.

The smear is drawn on this Mac's GPU (native/blur_render.swift, Core Image) with the hardware encoder when it can;
otherwise on the CPU here, the same way (tests/test_motion_blur.py compares the two).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.cutout_service import colour
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

logger = logging.getLogger(__name__)
VERSION = 1
GPU_TOOL = Path(__file__).resolve().parents[2] / 'native' / 'blur_render.swift'
SAMPLES = 16  # Points along each pixel's movement that are averaged.
PRESETS = {'natural': {'shutter': 0.5}, 'dreamy': {'shutter': 1.0}, 'action': {'shutter': 0.25}}  # 180°, 360°, 90°.
LONGEST = 0.08  # Most a pixel is smeared, as a share of the frame's width (a whip pan stays readable).


def target_path(source: Path, start: float, end: float, preset: str, tune: dict | None = None) -> Path:
    from app.services.look_tune import key
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), preset] + ([key(tune)] if tune else []))
    return settings.data_dir / 'media' / f'blur-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


class Motion:
    """How each pixel moves around a frame, in full-size pixels a frame: the average of the way into the next frame and
    the way back from the one before (so the blur sits centred on the movement), at `size`."""

    def __init__(self, width: int, height: int, size: tuple[int, int]):
        import cv2
        self.cv2, self.width, self.height, self.size = cv2, width, height, size
        self.half = (max(16, width // 2), max(16, height // 2))
        self.flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_FAST)

    def grey(self, frame: np.ndarray) -> np.ndarray:
        return self.cv2.cvtColor(self.cv2.resize(frame, self.half, interpolation=self.cv2.INTER_AREA), self.cv2.COLOR_BGR2GRAY)

    def around(self, before: np.ndarray | None, now: np.ndarray, after: np.ndarray | None) -> np.ndarray:
        cv2 = self.cv2
        ways = []
        if after is not None:
            ways.append(self.flow.calc(now, after, None))
        if before is not None:
            ways.append(-self.flow.calc(now, before, None))
        if not ways:
            return np.zeros((self.size[1], self.size[0], 2), np.float32)
        moved = sum(ways) / len(ways) * (self.width / self.half[0])
        longest = LONGEST * self.width
        length = np.linalg.norm(moved, axis=2, keepdims=True)
        moved = moved * np.minimum(1, longest / np.maximum(length, 1e-6))  # A whip pan stays readable.
        return cv2.resize(moved, self.size, interpolation=cv2.INTER_AREA).astype(np.float32)


def smear(frame: np.ndarray, motion: np.ndarray, shutter: float) -> np.ndarray:
    """One frame smeared along its motion (CPU): the average of SAMPLES points spread over `shutter` of each pixel's
    movement, centred on it. frame: H×W×3 uint8; motion: any size, full-size pixels."""
    import cv2
    height, width = frame.shape[:2]
    full = cv2.resize(motion, (width, height), interpolation=cv2.INTER_LINEAR) * shutter
    xs, ys = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    total = np.zeros(frame.shape, np.float32)
    for k in range(SAMPLES):
        t = (k + 0.5) / SAMPLES - 0.5
        total += cv2.remap(frame, xs + full[..., 0] * t, ys + full[..., 1] * t, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return (total / SAMPLES + 0.5).astype(np.uint8)


def make(facts: MediaFacts, start: float, end: float, preset: str, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False, tune: dict | None = None) -> Path:
    """The part start..end (source seconds) with motion blur, with its sound. Made once."""
    if preset not in PRESETS:
        raise ValueError('Choose natural film, dreamy smear or crisp action.')
    target = target_path(facts.path, start, end, preset, tune)
    if target.is_file():
        return target
    shutter = {**PRESETS[preset], **(tune or {})}['shutter']
    if os.environ.get('KANAA_GPU_EFFECTS') != '0':
        try:
            if _make(facts, start, end, shutter, target, on_progress, should_cancel, gpu=True):
                on_progress(100)
                return target
        except JobCancelled:
            raise
        except Exception:
            logger.exception('GPU motion blur failed; making it on the CPU')
    _make(facts, start, end, shutter, target, on_progress, should_cancel, gpu=False)
    on_progress(100)
    return target


def _make(facts: MediaFacts, start: float, end: float, shutter: float, target: Path, on_progress, should_cancel, gpu: bool) -> bool:
    """Reads the clip a frame ahead (each frame's motion needs the next one), measures the motion here, and smears on
    the GPU (blur_render) or here. False when the GPU tool can't be built, so the CPU path makes it."""
    import cv2
    from app.services.lens_service import hardware_encoder
    tool = None
    if gpu:
        from app.services.cutout_service import helper
        try:
            tool = helper(GPU_TOOL)
        except RuntimeError:
            return False
    ffmpeg = shutil.which('ffmpeg')
    width, height = facts.width or 1920, facts.height or 1080
    width, height = width - width % 2, height - height % 2
    fps = facts.fps or 30
    total = max(1, round((end - start) * fps))
    size = (max(8, width // 4), max(8, height // 4))  # Motion is smooth: a quarter-size copy carries it.
    span = ['-ss', f'{start:.3f}', '-t', f'{end - start:.3f}']
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *span, '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={width}:{height}',
                             '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    processes = [read]
    try:
        encoder = hardware_encoder(ffmpeg, height) if gpu else ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16']
        draw = None
        if gpu:
            draw = subprocess.Popen([str(tool), str(width), str(height), str(size[0]), str(size[1]), f'{shutter}'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            processes.append(draw)
        write = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra' if gpu else 'bgr24', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                                  *span, '-i', str(facts.path), '-map', '0:v', '-map', '1:a?', *encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                                  '-shortest', '-movflags', '+faststart', str(temporary)], stdin=draw.stdout if draw else subprocess.PIPE, stderr=subprocess.PIPE)
        processes.append(write)
        if draw:
            draw.stdout.close()
        motion = Motion(width, height, size)
        frame_size = width * height * 3
        assert read.stdout

        def next_frame():
            chunk = read.stdout.read(frame_size)
            return np.frombuffer(chunk, np.uint8).reshape(height, width, 3) if len(chunk) == frame_size else None

        def out(frame, moved):
            if draw:
                draw.stdin.write(moved.tobytes() + cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA).tobytes())
            else:
                write.stdin.write(smear(frame, moved, shutter).tobytes())

        previous, current = None, next_frame()
        greys = [None, motion.grey(current) if current is not None else None]
        done = 0
        while current is not None:
            if should_cancel():
                raise JobCancelled()
            following = next_frame()
            ahead = motion.grey(following) if following is not None else None
            out(current, motion.around(greys[0], greys[1], ahead))
            previous, current, greys = current, following, [greys[1], ahead]
            done += 1
            if done % 10 == 0:
                on_progress(min(98, done * 98 // total))
        (draw.stdin if draw else write.stdin).close()
        if (draw and draw.wait()) or write.wait() or done == 0 or not temporary.is_file():
            raise RuntimeError(f'Could not make the motion blur: {(write.stderr.read() if write.stderr else b"")[-300:]!r}')
        temporary.replace(target)
        return True
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
