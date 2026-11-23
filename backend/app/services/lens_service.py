"""Cinematic lens: real depth of field for any clip, from its depth map (depth_mask_service): what sits at the focus
distance stays sharp, and the further anything is from it (nearer or farther), the softer it goes, like a large
cinema lens. The focus can move over the clip (a rack focus). The result is a new video of the clip's part, so it
plays and exports like any clip (on the GPU too), and the original is kept to go back to.

Blur is drawn as a few ready-blurred copies of each frame, made and mixed small (soft light needs no detail): each
pixel blends between the two nearest by how far out of focus it is. In focus, the original full-size pixels show.
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
from app.services.depth_mask_service import make_depth_map
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

VERSION = 1
LEVELS = (0.0, 0.004, 0.009, 0.016, 0.026)  # Blur of each ready-blurred copy, as a share of the frame height.
SHARP = 0.06  # Nearness this close to the focus stays fully sharp.
PRESETS = {'portrait': 1.0, 'dreamy': 1.6, 'rack': 1.0}  # How strong each preset blurs.
STRENGTH = {'soft': 0.6, 'medium': 1.0, 'strong': 1.5}


def target_path(source: Path, start: float, end: float, focus: list[tuple[float, float]], amount: float, glow: bool) -> Path:
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), [(round(t, 3), round(f, 3)) for t, f in focus], round(amount, 3), glow])
    return settings.data_dir / 'media' / f'lens-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def focus_at(focus: list[tuple[float, float]], t: float) -> float:
    """The focus distance (nearness 0 far to 1 near) at `t` seconds into the part, eased between the points."""
    if t <= focus[0][0]:
        return focus[0][1]
    for (t0, f0), (t1, f1) in zip(focus, focus[1:]):
        if t < t1:
            p = (t - t0) / max(1e-6, t1 - t0)
            p = 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2  # Smooth, as a focus puller turns the ring.
            return f0 + (f1 - f0) * p
    return focus[-1][1]


def lens_frame(frame: np.ndarray, near: np.ndarray, focus: float, amount: float, glow: bool) -> np.ndarray:
    """One frame through the lens. frame: H×W×3 uint8; near: H×W 0..1 nearness at the same size (or any size)."""
    import cv2
    height, width = frame.shape[:2]
    small_w, small_h = max(16, width // 4), max(16, height // 4)
    small = cv2.resize(frame, (small_w, small_h), interpolation=cv2.INTER_AREA).astype(np.float32)
    near_small = cv2.resize(near, (small_w, small_h), interpolation=cv2.INTER_AREA)
    # How far out of focus each pixel is, 0 (sharp) to the last copy; smoothed so the blur never steps.
    steps = len(LEVELS) - 1
    off_small = cv2.GaussianBlur(np.clip((np.abs(near_small - focus) - SHARP) / (1 - SHARP), 0, 1).astype(np.float32) * steps, (0, 0), 1)
    # The blur is mixed small (soft light needs no detail): each pixel between its two nearest ready-blurred copies.
    mix = np.zeros_like(small)
    for k in range(1, steps + 1):
        copy = cv2.GaussianBlur(small, (0, 0), max(0.5, LEVELS[k] * amount * small_h))
        weight = np.clip(1 - np.abs(off_small - k), 0, 1) if k < steps else np.clip(off_small - (steps - 1), 0, 1)
        if k == 1:
            weight = np.clip(off_small, 0, 1) * (off_small <= 1) + weight * (off_small > 1)
        mix += copy * weight[..., None]
    total = np.clip(off_small, 0, 1)  # The share that is blurred at all.
    mix = mix / np.maximum(total, 1e-3)[..., None]
    if glow:  # Dreamy: the blurred highlights bloom a little.
        mix += np.clip(mix - 170, 0, None) * 0.5 * np.clip(off_small / steps, 0, 1)[..., None]
    # Once at full size: the sharp picture where in focus, the blurred mix elsewhere.
    mix_full = cv2.resize(np.clip(mix, 0, 255).astype(np.uint8), (width, height), interpolation=cv2.INTER_LINEAR)
    alpha = cv2.resize(total, (width, height), interpolation=cv2.INTER_LINEAR)
    return cv2.blendLinear(mix_full, np.ascontiguousarray(frame), alpha, 1 - alpha)


def make(facts: MediaFacts, start: float, end: float, focus: list[tuple[float, float]], amount: float = 1.0, glow: bool = False,
         on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The part start..end (source seconds) of the clip through the lens, with its sound. Made once."""
    import cv2
    target = target_path(facts.path, start, end, focus, amount, glow)
    if target.is_file():
        return target
    depth = make_depth_map(facts, lambda value: on_progress(value // 3), should_cancel)
    width, height = facts.width or 1920, facts.height or 1080
    width, height = width - width % 2, height - height % 2
    fps = facts.fps or 30
    total = max(1, round((end - start) * fps))
    ffmpeg = shutil.which('ffmpeg')
    read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', str(facts.path), '-an',
                             '-vf', f'{colour(facts)},scale={width}:{height}', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    read_depth = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', str(depth), '-vf', 'format=gray',
                                   '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    depth_w, depth_h = _size(depth)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    write = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                              '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', str(facts.path), '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'medium',
                              '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert read.stdout and read_depth.stdout and write.stdin
        frame_size, depth_size, done, near = width * height * 3, depth_w * depth_h, 0, None
        while chunk := read.stdout.read(frame_size):
            if should_cancel():
                raise JobCancelled()
            if len(chunk) < frame_size:
                break
            depth_chunk = read_depth.stdout.read(depth_size)
            if len(depth_chunk) == depth_size:  # A shorter depth map keeps its last frame.
                near = np.frombuffer(depth_chunk, np.uint8).reshape(depth_h, depth_w).astype(np.float32) / 255
            frame = np.frombuffer(chunk, np.uint8).reshape(height, width, 3)
            write.stdin.write(frame.tobytes() if near is None else lens_frame(frame, near, focus_at(focus, done / fps), amount, glow).tobytes())
            done += 1
            if done % 10 == 0:
                on_progress(33 + min(65, done * 65 // total))
        write.stdin.close()
        if write.wait() or done == 0:
            raise RuntimeError('Could not make the cinematic lens copy.')
        temporary.replace(target)
    finally:
        for process in (read, read_depth, write):
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
    on_progress(100)
    return target


def _size(path: Path) -> tuple[int, int]:
    out = subprocess.run([shutil.which('ffprobe'), '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout
    width, height = (int(value) for value in out.strip().split(',')[:2])
    return width, height


def plan(preset: str, strength: str, length: float) -> tuple[list[tuple[float, float]], float, bool]:
    """A preset's focus over the part (seconds, nearness), how strong the blur is, and whether highlights bloom."""
    amount = STRENGTH.get(strength, 1.0)
    if preset == 'rack-out':  # Near to far: the people first, then the view behind them.
        return [(0.0, 0.82), (min(0.6, length * 0.15), 0.82), (max(0.0, length - min(0.6, length * 0.15)), 0.12), (length, 0.12)], amount, False
    if preset == 'rack-in':
        return [(0.0, 0.12), (min(0.6, length * 0.15), 0.12), (max(0.0, length - min(0.6, length * 0.15)), 0.82), (length, 0.82)], amount, False
    if preset == 'dreamy':
        return [(0.0, 0.65)], amount * PRESETS['dreamy'], True
    return [(0.0, 0.65)], amount, False
