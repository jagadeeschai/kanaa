"""Glow outline: the edge of what was clicked in a picture or a video frame, for an explainer graphic.

Click to choose (MobileSAM) picks the object once; its edge is kept on the graphic as a simplified shape, so the
glow is drawn like any other graphic and looks the same in the preview and both exports."""
from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

from app.core.config import settings
from app.services import click_select
from app.services.media_service import get_media

MAX_POINTS = 160


def _picture(item: dict, at: float) -> Path:
    path = Path(item['absolute_path'])
    if item['media_type'] == 'image':
        return path
    if item['media_type'] != 'video':
        raise ValueError('A glow outline goes on a picture or a video.')
    key = hashlib.sha256(f'{path}|{path.stat().st_mtime_ns}|{at:.3f}'.encode()).hexdigest()[:20]
    target = settings.data_dir / 'cache' / 'outline-frames' / f'{key}.png'
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', f'{max(0.0, at):.3f}', '-i', str(path),
                                 '-frames:v', '1', str(target)], capture_output=True, timeout=60)
        if result.returncode or not target.exists():
            raise ValueError('Could not read that moment of the video.')
    return target


def edge(mask: np.ndarray) -> list[tuple[float, float]]:
    """The biggest piece's outer edge as at most MAX_POINTS shares of the mask's size."""
    height, width = mask.shape
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        raise ValueError('Nothing was found there. Click right on the thing to outline.')
    biggest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(biggest) < mask.size * 0.0005:
        raise ValueError('That is too small to outline. Click on something bigger.')
    tolerance = 0.002 * cv2.arcLength(biggest, True)
    simple = cv2.approxPolyDP(biggest, tolerance, True)
    while len(simple) > MAX_POINTS:
        tolerance *= 1.5
        simple = cv2.approxPolyDP(biggest, tolerance, True)
    return [(round(float(x) / width, 4), round(float(y) / height, 4)) for x, y in simple[:, 0, :]]


def outline(media_id: int, x: float, y: float, at: float = 0.0, encoder=None, decoder=None) -> dict:
    """x, y: shares of the source picture; at: seconds into a video. Returns the edge as shares of the source."""
    if not click_select.available() and encoder is None:
        raise LookupError('Click to choose is not installed: run ./install-fill.sh in the Kanaa folder.')
    item = dict(get_media(media_id))
    mask = click_select.mask_at(_picture(item, at), [{'x': x, 'y': y, 'keep': True}], encoder, decoder)
    shape = edge(mask)
    return {'shape': shape, 'area': round(float(mask.mean()), 4)}
