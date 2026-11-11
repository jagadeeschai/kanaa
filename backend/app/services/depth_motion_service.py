"""3D moving pictures: a still picture becomes a short video in which a camera glides through the scene.

The depth of every pixel comes from Depth Anything V2 Small (ONNX, backend/.models/depth, run on this Mac). Each frame
moves near things more than far ones: the camera pushes in and drifts sideways, so the foreground slides past the
background as in a real camera move. Depth is widened at its edges first, so a near object stretches the background
behind it rather than tearing.

The same depth says what stands up out of the scene (people, trees, pillars; not the ground, which only gets nearer
towards the bottom): pixels nearer than the rest of their row. That is written as the new video's person mask, the
file the cut-out uses (cutout_service.files), moved with the same camera. So "people in front" on a title or lyric
over this video puts those things in front of the words, in the preview and the export, with nothing else new.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.job_service import JobCancelled

logger = logging.getLogger(__name__)
MODEL = Path(__file__).resolve().parents[2] / '.models' / 'depth' / 'depth-anything-v2-small.onnx'
MODEL_SIDE = 518  # The model's own size, a multiple of its 14-pixel patches.
LONG_SIDE = 1920  # The video's long side.
FPS = 30
VERSION = 1
# The camera move over the clip, as shares of the picture: how much nearer it gets (near things grow by up to this),
# how far it drifts across (near things move up to this), and how much it starts zoomed in so no edge ever shows.
MOVES = {
    'push': {'zoom': 0.10, 'drift': 0.0, 'rise': 0.0},
    'drift': {'zoom': 0.04, 'drift': 0.05, 'rise': 0.0},
    'rise': {'zoom': 0.05, 'drift': 0.0, 'rise': 0.04},
}
FAR_SHARE = 0.25  # The farthest scene still moves this much of a near thing's move: real distance, not a flat backdrop.
STANDS_OUT = 0.08  # Of the depth range: how much nearer than its row a pixel must be to stand in front.
MIN_FRONT_AREA = 0.002  # A standing-out patch smaller than this share of the picture is noise.


def available() -> bool:
    return MODEL.is_file()


_session = None


def depth_of(rgb: np.ndarray) -> np.ndarray:
    """Relative nearness of each pixel, 0 (farthest) to 1 (nearest), at the picture's size."""
    global _session
    import cv2
    import onnxruntime
    if _session is None:
        if not MODEL.is_file():
            raise RuntimeError('3D pictures need the depth model, which is not on this Mac.')
        _session = onnxruntime.InferenceSession(str(MODEL), providers=['CoreMLExecutionProvider', 'CPUExecutionProvider'] if 'CoreMLExecutionProvider' in onnxruntime.get_available_providers() else ['CPUExecutionProvider'])
    height, width = rgb.shape[:2]
    scale = MODEL_SIDE / max(height, width)
    w, h = max(14, round(width * scale / 14) * 14), max(14, round(height * scale / 14) * 14)
    x = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    out = _session.run(None, {'pixel_values': x.transpose(2, 0, 1)[None]})[0][0]
    low, high = np.percentile(out, 2), np.percentile(out, 98)
    near = np.clip((out - low) / max(1e-6, high - low), 0, 1).astype(np.float32)
    return cv2.resize(near, (width, height), interpolation=cv2.INTER_CUBIC)


def widen(near: np.ndarray) -> np.ndarray:
    """Near things a little wider and the depth smooth, so their edges pull the background with them instead of tearing."""
    import cv2
    side = max(3, round(max(near.shape) * 0.006) | 1)
    grown = cv2.dilate(near, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (side, side)))
    return cv2.GaussianBlur(grown, (0, 0), side / 2)


def standing(near: np.ndarray) -> np.ndarray:
    """What stands up out of the scene: nearer than most of its own row (the ground only gets nearer downwards), as 0..255."""
    import cv2
    row = np.percentile(near, 40, axis=1, keepdims=True)
    on = (near - row > STANDS_OUT).astype(np.uint8)
    on = cv2.morphologyEx(on, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(on, 8)
    keep = np.zeros_like(on)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= MIN_FRONT_AREA * on.size:
            keep[labels == index] = 1
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    return keep * 255


def camera(near: np.ndarray, move: dict, progress: float, base: float) -> tuple[np.ndarray, np.ndarray]:
    """Where each pixel of the frame at `progress` (0..1) comes from in the picture: a backward map for cv2.remap."""
    height, width = near.shape
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    weight = FAR_SHARE + (1 - FAR_SHARE) * near
    ease = progress * progress * (3 - 2 * progress)  # Starts and ends gently.
    scale = base * (1 + move['zoom'] * ease * weight)
    dx = move['drift'] * (ease - 0.5) * weight * width
    dy = -move['rise'] * (ease - 0.5) * weight * height
    cx, cy = width / 2, height / 2
    return ((xs - cx - dx) / scale + cx).astype(np.float32), ((ys - cy - dy) / scale + cy).astype(np.float32)


def video_path(picture: Path, seconds: float, move: str) -> Path:
    ident = json.dumps([VERSION, hashlib.sha256(picture.read_bytes()).hexdigest()[:16], round(seconds, 2), move])
    return settings.data_dir / 'media' / f'depth-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def make(picture: Path, seconds: float, move: str = 'push', on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The picture as a `seconds`-long 3D moving video, and its standing-out mask written where the cut-out reads it."""
    import cv2
    from app.services import cutout_service
    target = video_path(picture, seconds, move)
    if target.is_file():
        return target
    rgb = cv2.cvtColor(cv2.imread(str(picture), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
    if rgb is None or rgb.size == 0:
        raise ValueError('Could not read this picture.')
    shrink = min(1, LONG_SIDE / max(rgb.shape[:2]))
    width, height = round(rgb.shape[1] * shrink / 2) * 2, round(rgb.shape[0] * shrink / 2) * 2
    rgb = cv2.resize(rgb, (width, height), interpolation=cv2.INTER_AREA)
    near = depth_of(rgb)
    on_progress(10)
    shape = MOVES[move]
    base = 1 + shape['drift'] + shape['rise'] + 0.02  # Enough to hide every edge the drift could show.
    smooth, front = widen(near), standing(near)
    frames = max(2, round(seconds * FPS))
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    mask_side = cutout_service.MASK_SIDE / max(width, height)
    mask_size = (max(2, round(width * mask_side / 2) * 2), max(2, round(height * mask_side / 2) * 2))
    mask_temporary = target.with_suffix('.mask.tmp.mp4')
    ffmpeg = shutil.which('ffmpeg')
    video = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(FPS), '-i', '-',
                              '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE)
    mask = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{mask_size[0]}x{mask_size[1]}', '-r', str(FPS), '-i', '-',
                             '-vf', f'gblur=sigma={cutout_service.EDGE_SOFTNESS}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', str(mask_temporary)], stdin=subprocess.PIPE)
    try:
        assert video.stdin is not None and mask.stdin is not None
        for index in range(frames):
            if should_cancel():
                raise JobCancelled()
            map_x, map_y = camera(smooth, shape, index / (frames - 1), base)
            video.stdin.write(cv2.remap(rgb, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT).tobytes())
            moved = cv2.remap(front, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            mask.stdin.write(cv2.resize(moved, mask_size, interpolation=cv2.INTER_AREA).tobytes())
            on_progress(10 + 85 * (index + 1) // frames)
        video.stdin.close(); mask.stdin.close()
        if video.wait() or mask.wait():
            raise RuntimeError('Could not make the 3D picture.')
        temporary.replace(target)
        # The cut-out finds this as the video's person mask, so "people in front" brings the standing-out things.
        person_mask = cutout_service.files(target)[cutout_service.MASK]
        person_mask.parent.mkdir(parents=True, exist_ok=True)
        mask_temporary.replace(person_mask)
    finally:
        for process in (video, mask):
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
        mask_temporary.unlink(missing_ok=True)
    on_progress(100)
    return target
