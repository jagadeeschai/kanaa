"""Night sky sparkle: for a picture with a night sky, twinkling stars in the sky only, a soft breathing glow around the
moon when there is one, and now and then a shooting star.

analyze() decides whether a picture has a night sky at all; nothing is made for a day picture. make() draws the light
on black, in the picture's own shape, so it lies over the picture with the Screen blend and, given the picture's own
move, stays fixed to its sky. Everything is drawn from code on this Mac.
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.job_service import JobCancelled

VERSION = 1
FPS = 30
LONG_SIDE = 1280  # Soft points of light scale up well; this keeps a long scene to well under a minute to make.
STUDY_SIDE = 640
MIN_SKY = 0.08  # Of the picture: less open sky than this is a glimpse between leaves, not a sky.
NIGHT = 95  # The sky's average lightness (0-255) must be below this.
STARS_PER_SKY = 220  # Stars across a sky filling the whole picture; fewer in a smaller sky.
SHOOTING_EVERY = 17.0  # Seconds between shooting stars.


def _read(picture: Path, side: int):
    import cv2
    image = cv2.imread(str(picture), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f'Could not read {picture.name}.')
    scale = side / max(image.shape[:2])
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image


def analyze(picture: Path) -> dict:
    """{'night': bool, 'sky': share of the picture that is open night sky, 'moon': [x, y, r] as shares of the width
    and height (r of the width) or None, 'reason': why not, for a person}. The sky mask itself comes from sky_mask()."""
    mask, image = sky_mask(picture)
    share = float(mask.mean())
    if share < MIN_SKY:
        return {'night': False, 'sky': round(share, 3), 'moon': None, 'reason': 'No open sky found in this picture.'}
    import cv2
    brightness = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)  # Lightness as the eye sees it: deep blue is dark.
    sky_level = float(brightness[mask > 0].mean())
    if sky_level >= NIGHT:
        return {'night': False, 'sky': round(share, 3), 'moon': None, 'reason': 'The sky in this picture is not a night sky.'}
    return {'night': True, 'sky': round(share, 3), 'moon': find_moon(image, brightness), 'reason': None}


def sky_mask(picture: Path):
    """Open sky: large smooth patches in the upper part of the picture that are night-blue, or plain dark. Leaves,
    roofs and people are textured or another colour, so they stay out; the sky need not reach the top edge (a canopy
    often covers it). Returns (mask 0/1 at study size, the study-size picture)."""
    import cv2
    image = _read(picture, STUDY_SIDE)
    height, width = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue, saturation, value = (hsv[..., n].astype(np.int32) for n in range(3))
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    texture = cv2.GaussianBlur(np.hypot(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1)), (0, 0), 4)
    blue = (hue >= 90) & (hue <= 135) & (saturation > 45) & (value > 15) & (value < 200)
    dark = (value < 55) & (saturation < 90)
    candidate = (blue | dark) & (texture < 45)
    candidate[int(height * 0.75):] = False  # The sky is never the bottom quarter.
    candidate = cv2.morphologyEx(candidate.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, centres = cv2.connectedComponentsWithStats(candidate, connectivity=4)
    keep = [n for n in range(1, count) if stats[n, cv2.CC_STAT_AREA] >= 0.01 * width * height and centres[n][1] < 0.55 * height]
    mask = np.isin(labels, keep).astype(np.uint8)
    # Fill the small holes left by stars, the moon and thin twigs, and keep a margin off the tree line.
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    mask = cv2.erode(mask, np.ones((5, 5), np.uint8))
    return mask, image


def find_moon(image, brightness) -> list[float] | None:
    """The moon: the roundest small bright spot in the upper part of the picture, with darker sky round it."""
    import cv2
    height, width = brightness.shape
    bright = (brightness > 225).astype(np.uint8)
    bright[int(height * 0.65):] = 0
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for contour in contours:
        area = cv2.contourArea(contour)
        if not (0.00005 * width * height <= area <= 0.03 * width * height):
            continue
        perimeter = cv2.arcLength(contour, True)
        round_ = 4 * math.pi * area / (perimeter * perimeter) if perimeter else 0
        (x, y), r = cv2.minEnclosingCircle(contour)
        ring = np.zeros_like(bright)
        cv2.circle(ring, (int(x), int(y)), int(r * 3 + 4), 1, -1)
        cv2.circle(ring, (int(x), int(y)), int(r * 1.6 + 2), 0, -1)
        around = float(brightness[ring > 0].mean()) if ring.any() else 255
        if round_ < 0.6 or around > 120:
            continue
        score = round_ * area
        if best is None or score > best[0]:
            best = (score, x / width, y / height, r / width)
    return [round(value, 4) for value in best[1:]] if best else None


def video_path(picture: Path, seconds: float) -> Path:
    ident = json.dumps([VERSION, hashlib.sha256(picture.read_bytes()).hexdigest()[:16], round(seconds, 2)])
    return settings.data_dir / 'media' / f'nightsky-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def _sprite(radius: float, cross: bool) -> np.ndarray:
    side = int(math.ceil(radius * (6 if cross else 3))) * 2 + 1
    c = side // 2
    ys, xs = np.mgrid[0:side, 0:side].astype(np.float32) - c
    dot = np.exp(-(xs * xs + ys * ys) / (2 * radius * radius))
    if cross:  # The four-pointed glint of a bright star.
        dot = np.maximum(dot, np.exp(-(ys * ys) / (0.6 * radius * radius)) * np.exp(-np.abs(xs) / (radius * 2.2)) * 0.8)
        dot = np.maximum(dot, np.exp(-(xs * xs) / (0.6 * radius * radius)) * np.exp(-np.abs(ys) / (radius * 2.2)) * 0.8)
    return dot


def make(picture: Path, seconds: float, on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The light as a `seconds`-long video on black, in the picture's shape. Raises ValueError for a day picture."""
    import cv2
    target = video_path(picture, seconds)
    if target.is_file():
        return target
    found = analyze(picture)
    if not found['night']:
        raise ValueError(found['reason'])
    study, _ = sky_mask(picture)
    full = _read(picture, LONG_SIDE)
    height, width = (round(side / 2) * 2 for side in full.shape[:2])
    unit = min(width, height)
    soft = cv2.GaussianBlur(cv2.resize(study.astype(np.float32), (width, height), interpolation=cv2.INTER_LINEAR), (0, 0), unit * 0.01)
    rng = np.random.default_rng(int(hashlib.sha256(picture.read_bytes()).hexdigest()[:8], 16))
    moon = found['moon']
    # Stars where the sky is, fewer close to the moon (its light hides them), a few bright ones with a glint.
    weight = soft.copy()
    if moon:
        ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
        weight *= np.clip(np.hypot(xs - moon[0] * width, ys - moon[1] * height) / (unit * 0.25), 0.15, 1)
    flat = weight.ravel() / weight.sum()
    count = max(25, round(STARS_PER_SKY * found['sky']))
    spots = rng.choice(flat.size, size=count, replace=False, p=flat)
    stars = [{'x': spot % width, 'y': spot // width, 'rate': rng.uniform(0.6, 2.2), 'phase': rng.uniform(0, 6.3), 'level': rng.uniform(0.35, 1.0),
              'bright': index < count // 12} for index, spot in enumerate(spots)]
    sprites = {False: _sprite(unit * 0.0016, False), True: _sprite(unit * 0.0022, True)}
    glow = None
    if moon:
        ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
        distance = np.hypot(xs - moon[0] * width, ys - moon[1] * height) / max(2.0, moon[2] * width)
        glow = np.exp(-np.maximum(0, distance - 1) / 2.2) * 0.55 + np.exp(-np.maximum(0, distance - 1) / 9) * 0.18
        glow[distance < 1] = 0.35  # The moon itself gets a little brighter, not washed out.
    shooting = [t for t in np.arange(SHOOTING_EVERY * 0.6, seconds, SHOOTING_EVERY)]
    lanes = [(rng.uniform(0.15, 0.85), rng.uniform(0.05, 0.3), rng.choice([-1, 1])) for _ in shooting]
    frames = max(2, round(seconds * FPS))
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(FPS),
                                '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE)
    colour = np.array([0.92, 0.95, 1.0], np.float32)  # Starlight, a touch blue.
    moonlight = np.array([1.0, 0.96, 0.85], np.float32)  # Moonlight, a touch warm.
    try:
        assert process.stdin is not None
        for n in range(frames):
            if should_cancel():
                raise JobCancelled()
            t = n / FPS
            light = np.zeros((height, width), np.float32)
            for star in stars:
                level = star['level'] * (0.25 + 0.75 * max(0.0, math.sin(t * star['rate'] + star['phase'])) ** 3)
                sprite = sprites[star['bright']]
                h = sprite.shape[0] // 2
                x0, y0 = int(star['x']) - h, int(star['y']) - h
                if x0 < 0 or y0 < 0 or x0 + sprite.shape[1] > width or y0 + sprite.shape[0] > height:
                    continue
                light[y0:y0 + sprite.shape[0], x0:x0 + sprite.shape[1]] += sprite * level
            for start, (x, y, way) in zip(shooting, lanes):
                p = (t - start) / 0.9
                if 0 <= p <= 1:
                    head = (x + way * 0.25 * p, y + 0.12 * p)
                    tail = (head[0] - way * 0.08, head[1] - 0.04)
                    streak = np.zeros_like(light)
                    cv2.line(streak, (int(tail[0] * width), int(tail[1] * height)), (int(head[0] * width), int(head[1] * height)), math.sin(p * math.pi), max(1, unit // 500), cv2.LINE_AA)
                    light += cv2.GaussianBlur(streak, (0, 0), 1.2) * 1.4
            light *= soft
            frame = light[..., None] * colour
            if glow is not None:
                frame += (glow * (0.82 + 0.18 * math.sin(t * 0.7)))[..., None] * moonlight
            process.stdin.write((np.clip(frame, 0, 1) * 255).astype(np.uint8)[:height, :width].tobytes())
            if n % 15 == 0:
                on_progress(5 + 90 * n // frames)
        process.stdin.close()
        if process.wait():
            raise RuntimeError('Could not make the night sky.')
        temporary.replace(target)
    finally:
        if process.poll() is None:
            process.kill()
        temporary.unlink(missing_ok=True)
    on_progress(100)
    return target
