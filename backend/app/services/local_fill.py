"""Filling a masked area on this Mac, free and offline, with LaMa (big-lama, Apache 2.0) through ONNX Runtime.

The model works on 512 x 512. A whole picture shrunk to that would come back blurred, so only a square around the
masked area is filled: cut out with room around it (so the model sees what surrounds the hole), filled, scaled back
and pasted. Outside the mask the caller keeps the original pixels anyway. Runs on the CPU: on an M1 Pro about 4 s,
faster than CoreML here, which can take only part of this model.
"""
import threading
from pathlib import Path

import numpy as np
from PIL import Image

from app.core.config import settings

MODEL = Path(__file__).resolve().parents[2] / '.models' / 'lama' / 'lama_fp32.onnx'
SIDE = 512
ROOM = 1.6  # The square cut out is this many times the masked area's longer side.
_session = None
_lock = threading.Lock()


def available() -> bool:
    return MODEL.is_file()


def _model():
    global _session
    with _lock:
        if _session is None:
            import onnxruntime
            _session = onnxruntime.InferenceSession(str(MODEL), providers=['CPUExecutionProvider'])
        return _session


def square_around(mask: np.ndarray) -> tuple[int, int, int, int]:
    """A square (left, top, right, bottom) around the masked area with room around it, inside the picture."""
    height, width = mask.shape
    ys, xs = np.nonzero(mask)
    side = min(max(width, height), max(64, int(max(xs.max() - xs.min(), ys.max() - ys.min()) * ROOM)))
    cx, cy = (xs.min() + xs.max()) // 2, (ys.min() + ys.max()) // 2
    left = int(min(max(0, cx - side // 2), max(0, width - side)))
    top = int(min(max(0, cy - side // 2), max(0, height - side)))
    return left, top, min(width, left + side), min(height, top + side)


def fill(picture: Image.Image, mask: Image.Image, run=None) -> Image.Image:
    """The picture with the white of `mask` filled from its surroundings. `run(image, mask)` can stand in for the model."""
    holes = np.asarray(mask.convert('L')) > 127
    if not holes.any():
        return picture.convert('RGB')
    box = square_around(holes)
    crop = picture.convert('RGB').crop(box).resize((SIDE, SIDE), Image.LANCZOS)
    hole = mask.convert('L').crop(box).resize((SIDE, SIDE), Image.NEAREST)
    image = (np.asarray(crop).astype(np.float32) / 255).transpose(2, 0, 1)[None]
    where = (np.asarray(hole) > 127).astype(np.float32)[None, None]
    if run is None:
        out = _model().run(None, {'image': image, 'mask': where})[0][0]
    else:
        out = run(image, where)
    if out.max() <= 1.5:  # Some exports give 0..1, this one 0..255.
        out = out * 255
    filled = Image.fromarray(np.clip(out.transpose(1, 2, 0), 0, 255).astype(np.uint8)).resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS)
    result = picture.convert('RGB').copy()
    result.paste(filled, box[:2])
    return result
