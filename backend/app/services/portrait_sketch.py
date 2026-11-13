"""A small black-and-white line portrait from a real photograph, to credit a person (a lyricist, a singer) beside
their name: the face found by Apple Vision, drawn as clean ink lines on white, in a round frame with a thin warm rim.
Made from the photo itself, so it is the person's own likeness, never an invented one."""
from __future__ import annotations

from pathlib import Path

import numpy as np

SIDE = 640


def face_box(photo: Path, image) -> tuple[int, int, int, int]:
    """The largest face as pixels (x, y, w, h); the upper middle when none is found."""
    height, width = image.shape[:2]
    try:
        from app.services.lamp_glow_service import faces_in
        faces = faces_in(photo)
    except Exception:
        faces = []
    if faces:
        x, y, w, h = max(faces, key=lambda face: face[2] * face[3])
        return int(x * width), int(y * height), int(w * width), int(h * height)
    side = min(width, height) // 2
    return (width - side) // 2, height // 5, side, side


def sketch(photo: Path, target: Path) -> Path:
    import cv2
    from PIL import Image, ImageOps
    image = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(Image.open(photo)).convert('RGB')), cv2.COLOR_RGB2BGR)
    x, y, w, h = face_box(photo, image)
    # Head and shoulders: the face a little above the middle, room for hair and collar.
    cx, cy, half = x + w / 2, y + h * 0.62, max(w, h) * 1.55
    height, width = image.shape[:2]
    left, top = int(max(0, cx - half)), int(max(0, cy - half))
    right, bottom = int(min(width, cx + half)), int(min(height, cy + half))
    crop = cv2.resize(image[top:bottom, left:right], (SIDE, SIDE), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    smooth = cv2.bilateralFilter(gray, 9, 40, 9)
    # Pencil lines (colour dodge of the inverted blur), then cleaned to ink: dark lines, white paper.
    dodge = cv2.divide(smooth, 255 - cv2.GaussianBlur(255 - smooth, (0, 0), 9), scale=256).astype(np.float32)
    ink = np.where(dodge > 225, 255, dodge * 0.55)  # Paper stays clean white; strokes go darker.
    # The darkest parts (hair, glasses, moustache) filled in as solid ink, as an artist would.
    dark = cv2.GaussianBlur((gray < 55).astype(np.float32), (0, 0), 1.2)
    ink = ink * (1 - dark) + 25 * dark
    ink = cv2.GaussianBlur(ink.astype(np.uint8), (0, 0), 0.7)
    # The round frame: white disc, a thin warm rim, see-through outside.
    yy, xx = np.mgrid[0:SIDE, 0:SIDE].astype(np.float32)
    r = np.hypot(xx - SIDE / 2, yy - SIDE / 2) / (SIDE / 2)
    rgb = np.stack([ink] * 3, axis=-1).astype(np.float32)
    rim = (r > 0.93) & (r <= 0.985)
    rgb[rim] = (98, 160, 196)  # Warm gold, as the titles (blue, green, red here).
    alpha = np.clip((0.995 - r) * 200, 0, 1) * 255
    out = np.dstack([rgb[..., 2], rgb[..., 1], rgb[..., 0], alpha]).astype(np.uint8)  # BGR to RGB, with alpha.
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, 'RGBA').save(target)
    return target
