"""The export of a title in 3D: its picture warped frame by frame through the same corners the preview draws.

title3d.py works out four corners per depth layer; here OpenCV warps the title picture to them, back to front, with
the sides shaded in the depth colour, and the frames are written as a short see-through video. timeline_service then
lays that video over the frame where a flat title's posed picture would go.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from PIL import Image

from app.services import title3d

PinAt = Callable[[float], 'list[list[float]] | None']  # Timeline seconds to the pin matrix, or None.


def alpha_box(alpha: np.ndarray) -> tuple[float, float, float, float] | None:
    """The letters' box as shares of the picture: alpha over ALPHA_EDGE, padded 4 pixels. Same rule as alphaBox in title3d.ts."""
    rows, cols = np.nonzero(alpha > title3d.ALPHA_EDGE)
    if not rows.size:
        return None
    height, width = alpha.shape
    pad = 4
    x0, y0 = max(0, cols.min() - pad), max(0, rows.min() - pad)
    x1, y1 = min(width, cols.max() + 1 + pad), min(height, rows.max() + 1 + pad)
    return x0 / width, y0 / height, x1 / width, y1 / height


def render_title_frames(text, picture: Path, size: tuple[int, int], fps: int, frames: int, target: Path, pin_at: PinAt | None = None,
                        should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """`frames` frames of the title from its start, see-through, at `size`. Returns `target` (an ffv1 video with alpha)."""
    width, height = size
    rgba = np.asarray(Image.open(picture).convert('RGBA').resize((width, height), Image.BILINEAR), np.float32) / 255
    box = alpha_box((rgba[..., 3] * 255).astype(np.uint8))
    premultiplied = rgba.copy()
    premultiplied[..., :3] *= premultiplied[..., 3:4]
    depth = text.depth if text.depth and text.depth.amount > 0 else None
    shares = title3d.layers(depth)
    colour = np.array([int(depth.color[at:at + 2], 16) / 255 for at in (1, 3, 5)], np.float32) if depth else None
    target.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}',
                                '-r', str(fps), '-i', '-', '-c:v', 'ffv1', '-pix_fmt', 'bgra', str(target)], stdin=subprocess.PIPE)
    try:
        assert process.stdin is not None
        for n in range(frames):
            if should_cancel():
                raise RuntimeError('Cancelled.')
            process.stdin.write(frame_at(text, n / fps, premultiplied, box, shares, depth, colour, size, pin_at(text.start + n / fps) if pin_at else None).tobytes())
        process.stdin.close()
        if process.wait(timeout=600):
            raise RuntimeError('Could not draw this 3D title.')
    except BaseException:
        process.kill()
        target.unlink(missing_ok=True)
        raise
    return target


def frame_at(text, local: float, premultiplied: np.ndarray, box, shares, depth, colour, size: tuple[int, int], pin) -> np.ndarray:
    """One frame of the title, 8-bit straight RGBA, as the preview's drawTitle3d draws it.

    Only the letters' box of the title picture is warped, and only into the part of the frame its corners reach: a
    title rarely covers much of the frame, and this keeps a 1080p frame to a few tens of milliseconds."""
    from app.services.timeline_schema import value_at
    width, height = size
    out = np.zeros((height, width, 4), np.uint8)
    if box is None:
        return out
    pose, look = title3d.pose_at(text, local)
    opacity = look['opacity'] * max(0.0, min(1.0, value_at(text.transform, 'opacity', local)))
    if opacity <= 0:
        return out
    frame_box = (box[0] * width, box[1] * height, box[2] * width, box[3] * height)
    source = [(frame_box[0], frame_box[1]), (frame_box[2], frame_box[1]), (frame_box[2], frame_box[3]), (frame_box[0], frame_box[3])]
    x0, y0, x1, y1 = (round(v) for v in frame_box)
    crop = np.ascontiguousarray(premultiplied[y0:y1, x0:x1])
    shift = np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1]], np.float64)
    placed = []
    for index in range(len(shares) - 1, -1, -1):  # Back to front.
        try:
            target = title3d.corners(pose, frame_box, size, shares[index], depth.amount if depth else 0, pin)
            placed.append((index, target, np.array(title3d.homography(source, target), np.float64) @ shift))
        except ValueError:
            continue
    if not placed:
        return out
    blur = look['blur'] * height
    margin = 2 + (int(3 * blur) + 1 if blur > 0 else 0)
    xs = [x for _, target, _ in placed for x, _ in target]
    ys = [y for _, target, _ in placed for _, y in target]
    left, top = max(0, int(min(xs)) - margin), max(0, int(min(ys)) - margin)
    right, bottom = min(width, int(max(xs)) + margin + 1), min(height, int(max(ys)) + margin + 1)
    if right <= left or bottom <= top:
        return out
    region = np.zeros((bottom - top, right - left, 4), np.float32)
    offset = np.array([[1, 0, -left], [0, 1, -top], [0, 0, 1]], np.float64)
    for index, _, matrix in placed:
        layer = cv2.warpPerspective(crop, offset @ matrix, (right - left, bottom - top), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        if index > 0 and depth is not None:
            # The sides: the letters' shape in the depth colour, darker further back (premultiplied, like the preview's mix).
            layer[..., :3] = layer[..., 3:4] * colour * title3d.layer_shade(depth, shares[index])
        region = layer * opacity + region * (1 - layer[..., 3:4] * opacity)
    if blur > 0:
        region = cv2.GaussianBlur(region, (0, 0), blur)
    alpha = region[..., 3:4]
    straight = np.where(alpha > 1e-4, region[..., :3] / np.maximum(alpha, 1e-4), 0)
    out[top:bottom, left:right] = np.clip(np.concatenate([straight, alpha], -1) * 255 + .5, 0, 255).astype(np.uint8)
    return out
