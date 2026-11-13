"""Picture lights: a picture's night sky (sky_light_service.py) and its lamps (lamp_glow_service.py) drawn together on
black, as one video in the picture's shape, to lay over the picture with the Screen blend. Only what the picture has
is drawn; a picture with neither gets nothing."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services import lamp_glow_service, sky_light_service
from app.services.job_service import JobCancelled

VERSION = 1
FPS = 30
LONG_SIDE = 1280  # Soft light scales up well; this keeps a long scene to a minute or so to make.


def analyze(picture: Path, sky: bool = True, lamps: bool = True) -> dict:
    """What the picture has: {'sky': the night-sky facts or None, 'lamps': the lamps or [], 'reason' when neither}."""
    night = sky_light_service.analyze(picture) if sky else {'night': False, 'reason': None}
    lit = lamp_glow_service.analyze(picture) if lamps else {'lamps': [], 'reason': None}
    found = {'sky': night if night['night'] else None, 'lamps': lit['lamps']}
    if not found['sky'] and not found['lamps']:
        reasons = [reason for reason in (night.get('reason'), lit.get('reason')) if reason]
        found['reason'] = ' '.join(reasons) or 'Nothing to light in this picture.'
    return found


def video_path(picture: Path, seconds: float, sky: bool, lamps: bool) -> Path:
    ident = json.dumps([VERSION, hashlib.sha256(picture.read_bytes()).hexdigest()[:16], round(seconds, 2), sky, lamps])
    return settings.data_dir / 'media' / f'lights-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def size_of(picture: Path) -> tuple[int, int]:
    from PIL import Image
    with Image.open(picture) as image:
        width, height = image.size
    scale = min(1, LONG_SIDE / max(width, height))
    return round(width * scale / 2) * 2, round(height * scale / 2) * 2


def make(picture: Path, seconds: float, sky: bool = True, lamps: bool = True, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The lights as a `seconds`-long video on black. Raises ValueError when the picture has nothing to light."""
    target = video_path(picture, seconds, sky, lamps)
    if target.is_file():
        return target
    found = analyze(picture, sky, lamps)
    if found.get('reason'):
        raise ValueError(found['reason'])
    width, height = size_of(picture)
    painters = [draw for draw in (sky_light_service.painter(picture, seconds, (width, height), found['sky']) if found['sky'] else None,
                                  lamp_glow_service.painter(picture, seconds, (width, height), {'lamps': found['lamps']}) if found['lamps'] else None) if draw]
    frames = max(2, round(seconds * FPS))
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(FPS),
                                '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE)
    try:
        assert process.stdin is not None
        for n in range(frames):
            if should_cancel():
                raise JobCancelled()
            t = n / FPS
            frame = sum(draw(t) for draw in painters)
            process.stdin.write((np.clip(frame, 0, 1) * 255).astype(np.uint8).tobytes())
            if n % 15 == 0:
                on_progress(5 + 90 * n // frames)
        process.stdin.close()
        if process.wait():
            raise RuntimeError('Could not make the picture lights.')
        temporary.replace(target)
    finally:
        if process.poll() is None:
            process.kill()
        temporary.unlink(missing_ok=True)
    on_progress(100)
    return target
