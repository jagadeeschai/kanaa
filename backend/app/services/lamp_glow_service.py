"""Lamp glow: oil lamps, lanterns and lit windows in a picture flicker like flames, with a warm halo that breathes and a
faint glow on what is near them; big flames now and then send up a spark.

analyze() finds the lights: small, warm, bright spots much brighter than what is round them. A picture with none is
left alone. painter() draws the glow on black, frame by frame (picture_lights_service.py makes the video).
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np

STUDY_SIDE = 960  # Lamps are small: look a little closer than for the sky.
DUSK = 100  # A picture whose middle lightness (0-255) is above this is in daylight.
MOST = 40  # The brightest lamps glow; a village of a hundred tiny lights is a texture, not lamps.


# Vision's scene labels for things that give light. When it sees one, a brighter picture is searched for lamps too.
LIGHT_LABELS = {'light', 'lamp', 'lantern', 'candle', 'candlestick', 'lamppost', 'chandelier', 'fireworks', 'bonfire', 'fire', 'string_lights',
                'christmas_lights', 'diya', 'torch', 'campfire', 'lightbulb', 'neon'}
SEEN = 0.15  # Vision's confidence that counts as seeing it.
BRIGHT = 140  # Even with lamps seen, a picture brighter than this in the middle is full daylight.


def vision_sees_lights(picture: Path) -> list[str]:
    """The light-giving things Apple Vision sees in the picture (empty off a Mac, or without its tools)."""
    import json
    import subprocess
    try:
        from app.services.cutout_service import helper
        tool = helper(Path(__file__).resolve().parents[2] / 'native' / 'scene_labels.swift')
        labels = json.loads(subprocess.run([str(tool), str(picture)], capture_output=True, text=True, timeout=60, check=True).stdout)['labels']
    except Exception:
        return []
    return [name for name, confidence in labels if name in LIGHT_LABELS and confidence >= SEEN]


def analyze(picture: Path, mode: str = 'auto', regions: list[list[float]] | None = None) -> dict:
    """{'lamps': [[x, y, r, strength]...] as shares (r of the width), largest first, 'reason' when none, 'seen': what
    Vision recognised}. mode: 'auto' (dusk and night pictures, and brighter ones where Vision sees lamps or lanterns),
    'always' (any picture), 'marked' (only inside `regions`, [x0, y0, x1, y1] shares of the picture, which the person
    drew round the lights: a light is found in each, or the area itself glows)."""
    import cv2
    image = cv2.imread(str(picture), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f'Could not read {picture.name}.')
    scale = STUDY_SIDE / max(image.shape[:2])
    if scale < 1:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    height, width = image.shape[:2]
    if mode == 'marked':
        return _marked(image, regions or [])
    # Lamps light a scene at dusk or night; by day, bright warm spots are sunlight through leaves. A brighter picture
    # is still searched when Vision recognises lamps, lanterns or candles in it (or the person asks for it).
    middle = float(np.median(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)))
    seen = vision_sees_lights(picture) if middle > DUSK and mode == 'auto' else []
    if mode == 'auto' and middle > DUSK and not (seen and middle <= BRIGHT):
        return {'lamps': [], 'seen': seen, 'reason': 'This picture is in daylight; its lamps would not show.'}
    surround = 105 if middle <= DUSK else 160  # In a brighter picture a lantern sits among lit things.
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue, saturation, value = (hsv[..., n].astype(np.int32) for n in range(3))
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    around = cv2.GaussianBlur(gray, (0, 0), 12)
    # A flame or lamp: as bright as it gets, warm, and much brighter than what surrounds it.
    warm = ((hue <= 35) | (hue >= 170)) & (saturation > 70)
    # The surroundings must be dim: a marigold or a sunlit sari is bright too, but lit by day, not giving light.
    dim = cv2.GaussianBlur(gray, (0, 0), 25)
    lit = (value > 245) & warm & (gray - around > 55) & (dim < surround)
    lit = cv2.morphologyEx(lit.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, centres = cv2.connectedComponentsWithStats(lit, connectivity=8)
    lamps = []
    for n in range(1, count):
        area = stats[n, cv2.CC_STAT_AREA]
        if not (0.000004 * width * height <= area <= 0.004 * width * height):
            continue
        w, h = stats[n, cv2.CC_STAT_WIDTH], stats[n, cv2.CC_STAT_HEIGHT]
        if max(w, h) > 6 * min(w, h):
            continue  # A long bright edge (a sunlit rail, a sari border), not a lamp.
        x, y = centres[n]
        if y < height * 0.02:
            continue
        strength = float((gray[labels == n] - around[labels == n]).mean()) / 255
        lamps.append([round(x / width, 4), round(y / height, 4), round(math.sqrt(area / math.pi) / width, 4), round(strength, 3)])
    lamps.sort(key=lambda lamp: -lamp[2] * lamp[3])
    lamps = lamps[:MOST]
    return {'lamps': lamps, 'seen': seen, 'reason': None if lamps else 'No lamps or lights found in this picture.'}


def _marked(image, regions: list[list[float]]) -> dict:
    """In each area the person drew: its brightest warm spot glows; if it has none, the whole area glows softly."""
    import cv2
    height, width = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lamps = []
    for x0, y0, x1, y1 in regions[:MOST]:
        a, b = sorted((max(0.0, min(1.0, x0)), max(0.0, min(1.0, x1)))); c, d = sorted((max(0.0, min(1.0, y0)), max(0.0, min(1.0, y1))))
        left, right, top, bottom = int(a * width), max(int(a * width) + 1, int(b * width)), int(c * height), max(int(c * height) + 1, int(d * height))
        patch = gray[top:bottom, left:right]
        warm = ((hsv[top:bottom, left:right, 0] <= 35) | (hsv[top:bottom, left:right, 0] >= 170)) & (hsv[top:bottom, left:right, 1] > 60)
        score = np.where(warm, patch, patch * 0.6)
        y, x = np.unravel_index(int(np.argmax(score)), score.shape)
        box = min(right - left, bottom - top)
        found = float(score[y, x]) > 200
        lamps.append([round((left + x) / width, 4), round((top + y) / height, 4), round((box / 8 if found else box / 4) / width, 4), 0.6 if found else 0.35])
    return {'lamps': lamps, 'seen': [], 'reason': None if lamps else 'Mark the lights first.'}


def _flicker(rng):
    """A flame's brightness over time: slow breathing plus quick uneven flutter, its own for each lamp."""
    slow, quick = rng.uniform(0.3, 0.7), rng.uniform(5, 9)
    phases = rng.uniform(0, 6.3, 3)
    return lambda t: 0.72 + 0.14 * math.sin(t * slow * 6.28 + phases[0]) + 0.1 * math.sin(t * quick + phases[1]) + 0.07 * math.sin(t * quick * 1.73 + phases[2])


def painter(picture: Path, seconds: float, size: tuple[int, int], found: dict | None = None):
    """draw(t) -> the lamps' glow at `t` seconds, float RGB 0..1 at `size`. None when the picture has no lamps."""
    found = found or analyze(picture)
    if not found['lamps']:
        return None
    width, height = size
    rng = np.random.default_rng(int(hashlib.sha256(picture.read_bytes()).hexdigest()[8:16], 16))
    flame = np.array([1.0, 0.72, 0.36], np.float32)  # Warm oil-lamp light.
    lamps = []
    for x, y, r, strength in found['lamps']:
        cx, cy, radius = x * width, y * height, max(min(width, height) * 0.006, r * width)  # Even a tiny flame lights a room.
        reach = int(radius * 16) + 2
        x0, x1, y0, y1 = max(0, int(cx) - reach), min(width, int(cx) + reach), max(0, int(cy) - reach // 2), min(height, int(cy) + reach)
        ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        d = np.hypot(xs - cx, ys - cy) / radius
        halo = np.exp(-d / 1.6) * 0.55 + np.exp(-d / 5) * 0.22 + np.exp(-d / 14) * 0.08
        spill = np.exp(-(((xs - cx) / (radius * 12)) ** 2 + ((ys - cy - radius * 5) / (radius * 7)) ** 2)) * 0.12  # On the floor and wall below it.
        weight = min(1.0, 0.45 + strength)
        lamps.append({'box': (y0, y1, x0, x1), 'halo': (halo * weight).astype(np.float32), 'spill': (spill * weight).astype(np.float32), 'flicker': _flicker(rng),
                      'centre': (cx, cy), 'radius': radius, 'sparks': list(rng.uniform(1, max(2.0, seconds), int(seconds / 4))) if radius > 3.5 else []})

    def draw(t: float) -> np.ndarray:
        light = np.zeros((height, width), np.float32)
        for lamp in lamps:
            y0, y1, x0, x1 = lamp['box']
            level = lamp['flicker'](t)
            light[y0:y1, x0:x1] += lamp['halo'] * level + lamp['spill'] * (0.6 + 0.4 * level)
            for start in lamp['sparks']:  # A tiny spark rising from the flame and going out.
                p = (t - start) / 1.4
                if 0 <= p <= 1:
                    sx = int(lamp['centre'][0] + math.sin(start * 7 + p * 4) * lamp['radius'] * 1.5)
                    sy = int(lamp['centre'][1] - lamp['radius'] * (2 + p * 14))
                    if 0 <= sx < width and 0 <= sy < height:
                        light[max(0, sy - 1):sy + 2, max(0, sx - 1):sx + 2] += 0.9 * (1 - p)
        return light[..., None] * flame

    return draw
