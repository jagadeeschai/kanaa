"""Where the people are in a photo or a video frame, so photo moves push in towards faces instead of the middle.

Uses the same YuNet face finder as Blur faces (face_service.py). Runs on this Mac.
"""
from __future__ import annotations

import shutil
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from PIL import Image, ImageOps

from app.services.face_service import Box, yunet

WORK_LONG_SIDE = 640  # Big enough to find a face a tenth of the picture wide.
# Faces much smaller than the biggest one are usually people in the background.
MIN_SHARE_OF_BIGGEST = 0.2


def focus_point(found: list[tuple[Box, float]]) -> Optional[tuple[float, float]]:
    """The middle of the main faces, weighted by size, from 0 to 1 across the picture. None when there are none."""
    if not found:
        return None
    biggest = max(w * h for (_, _, w, h), _ in found)
    main = [(x, y, w * h * score) for (x, y, w, h), score in found if w * h >= biggest * MIN_SHARE_OF_BIGGEST]
    weight = sum(item[2] for item in main)
    return round(sum(x * k for x, _, k in main) / weight, 4), round(sum(y * k for _, y, k in main) / weight, 4)


def work_size(width: int, height: int) -> tuple[int, int]:
    scale = WORK_LONG_SIDE / max(width, height)
    return max(2, round(width * scale) // 2 * 2), max(2, round(height * scale) // 2 * 2)


def picture(path: Path, media_type: str, at: float, size: tuple[int, int]) -> np.ndarray:
    """One BGR picture of `size`: the photo itself, or the video's frame at `at` seconds."""
    if media_type == 'image':
        with Image.open(path) as image:
            rgb = ImageOps.exif_transpose(image).convert('RGB').resize(size)
        return np.asarray(rgb)[:, :, ::-1].copy()
    width, height = size
    result = subprocess.run([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-ss', f'{max(0.0, at):.3f}', '-i', str(path), '-frames:v', '1',
                             '-vf', f'scale={width}:{height}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True, timeout=60)
    if len(result.stdout) < width * height * 3:
        raise ValueError('Could not read a frame from this video.')
    return np.frombuffer(result.stdout[:width * height * 3], np.uint8).reshape(height, width, 3)


def find_focus(path: Path, media_type: str, width: int, height: int, at: float = 0.0,
               detector_factory: Callable[[tuple[int, int]], Callable[[np.ndarray], list[tuple[Box, float]]]] | None = None) -> dict:
    size = work_size(width, height)
    found = (detector_factory or yunet)(size)(picture(path, media_type, at, size))
    point = focus_point(found)
    return {'x': point[0] if point else None, 'y': point[1] if point else None, 'faces': len(found)}


@lru_cache(maxsize=512)
def cached_focus(path: str, media_type: str, width: int, height: int, at: float, changed: float) -> dict:
    """`changed` (the file's modified time) keeps a replaced file from reusing an old answer."""
    return find_focus(Path(path), media_type, width, height, at)
