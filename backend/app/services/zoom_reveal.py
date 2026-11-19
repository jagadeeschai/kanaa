"""Zoom through the letters: a video-inside-text title flies into one of its letters until the scene fills the frame.

The preview zooms the title's one picture (a GPU texture can be magnified any amount). The exports can't scale a frame
40 times over, so every video-inside title is drawn here frame by frame, already in place, from the same per-frame values the GPU
engine uses (gpu_render._frames): its position, size, see-through and any enter or exit move."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image



def needs_frames(item) -> bool:
    """Every video-inside-text title: drawn here so its colour always fills the whole frame around the letters, however
    the title is moved or sized (a plain picture would leave its edges showing), and so it can zoom any amount."""
    return bool(item.knockout)


def deepest_point(picture: Path) -> tuple[float, float]:
    """The middle of the thickest part of the letters' holes, as shares of the frame: the place to fly into."""
    with Image.open(picture) as image:
        alpha = np.asarray(image.convert('RGBA'))[..., 3]
    hole = (alpha < 128).astype(np.uint8)
    hole[[0, -1], :] = 0; hole[:, [0, -1]] = 0  # The frame's edge is not a letter.
    if not hole.any():
        return 0.5, 0.5
    depth = cv2.distanceTransform(hole, cv2.DIST_L2, 5)
    height, width = depth.shape
    # Prefer letters near the middle a little, so the flight stays near the centre.
    ys, xs = np.mgrid[0:height, 0:width]
    score = depth - 0.02 * np.hypot(xs - width / 2, ys - height / 2) / max(width, height) * depth.max() * 10
    y, x = np.unravel_index(int(np.argmax(score)), score.shape)
    return round((x + 0.5) / width, 5), round((y + 0.5) / height, 5)


def frames(item, picture: Path, size: tuple[int, int], fps: int, count: int, folder: Path, name: str) -> tuple[list[str], list[int]]:
    """PNGs of the title already posed for each frame (repeats shared), and which one each frame shows."""
    from app.services.gpu_render import _frames
    width, height = size
    with Image.open(picture) as image:
        card = np.asarray(image.convert('RGBA'))
    around = tuple(int(item.knockout[i:i + 2], 16) for i in (1, 3, 5)) + (255,)  # The card's colour, past its edges too.
    pose = _frames(item.transform, item.enter, item.exit, count / fps, count, fps)
    paths, shown, seen = [], [], {}
    for k in range(count):
        s, x, y = pose['scale'][k] * pose['zoom'][k], pose['x'][k], pose['y'][k]
        # The item about its middle at (x, y), then the whole frame's enter/exit move about the frame's middle.
        cx = width / 2 + (x * width - width / 2) * pose['zoom'][k] + pose['dx'][k] * width
        cy = height / 2 + (y * height - height / 2) * pose['zoom'][k] + pose['dy'][k] * height
        key = (round(s, 5), round(cx, 2), round(cy, 2), round(pose['opacity'][k], 4))
        if key not in seen:
            matrix = np.float32([[s, 0, cx - s * width / 2], [0, s, cy - s * height / 2]])
            posed = cv2.warpAffine(card, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=around)
            if pose['opacity'][k] < 1:
                posed = posed.copy(); posed[..., 3] = (posed[..., 3] * pose['opacity'][k]).astype(np.uint8)
            path = folder / f'{name}-zoom{len(paths)}.png'
            Image.fromarray(posed, 'RGBA').save(path, compress_level=1)
            seen[key] = len(paths); paths.append(str(path))
        shown.append(seen[key])
    return paths, shown
