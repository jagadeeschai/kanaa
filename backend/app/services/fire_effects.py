"""Fire overlays (Screen blend, light on black), for songs that need to burn: flames licking up from the bottom of the
frame, firelight flickering up from a fire just out of shot, and a burst of sparks as a hammer meets an anvil.

Like cinematic_lights, every frame depends only on its number and the size: no caches, no randomness between calls,
so seeking, parallel renders and a remade effect always give the same picture. The flames and the firelight loop
seamlessly over the effect's 5 s (every wave turns a whole number of times), so the clip can repeat under a long scene.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# id, English, Tamil, one-line description; registered by effect_service.
FIRE = [
    ('flames', 'Rising flames', 'எழும் தீப்பிழம்பு', 'Tongues of flame licking up from the bottom of the frame'),
    ('fire-glow', 'Fire glow', 'நெருப்பு ஒளி', 'Warm firelight flickering up from a fire just out of shot'),
    ('spark-burst', 'Spark burst', 'தீப்பொறி வெடிப்பு', 'Sparks bursting out and falling, like a hammer on an anvil; place it on a beat'),
]
LOOP = 5.0  # Seconds: the effects' own length (effect_service.SECONDS); the flames and glow repeat exactly after it.
FPS = 30


def _waves(x: np.ndarray, b: np.ndarray, t: float, terms: list[tuple[float, float, int, float, float]]) -> np.ndarray:
    """A sum of travelling waves: (across, up, turns per loop, phase, weight). Whole turns per loop make it repeat."""
    field = np.zeros_like(x)
    for across, up, turns, phase, weight in terms:
        field += weight * np.sin(2 * math.pi * (across * x + up * b - turns * t / LOOP) + phase)
    return field


def _fire_colour(heat: np.ndarray) -> np.ndarray:
    """Black body: dark red at the edge of a flame, orange, then yellow-white at its hottest."""
    r = np.clip(heat * 2.1, 0, 1)
    g = np.clip(heat * 1.7 - 0.45, 0, 1)
    b = np.clip(heat * 2.4 - 1.75, 0, 1)
    return np.stack([r, g, b], -1)


def flames(n: int, total: int, size: tuple[int, int], rng=None) -> Image.Image:
    width, height = size
    sw, sh = max(32, width // 4), max(32, height // 4)  # Fire is soft: a small grid, smoothed up.
    y, x = np.mgrid[:sh, :sw].astype(np.float32)
    x, b = (x + 0.5) / sw * (width / height), 1 - (y + 0.5) / sh  # b: height above the bottom edge, 0..1.
    t = n / FPS
    # The turbulence rises faster than the flame's outline, so tongues lick upwards and break off.
    turbulence = _waves(x, b, t, [(1.3, 2.2, 3, 0.4, 0.5), (2.9, 3.6, 5, 1.9, 0.3), (5.7, 6.1, 8, 4.1, 0.18), (9.3, 9.0, 12, 2.7, 0.1)])
    outline = _waves(x, np.zeros_like(b), t, [(2.1, 0, 2, 0.0, 0.55), (4.7, 0, 3, 2.3, 0.3), (8.9, 0, 5, 5.1, 0.15)])
    reach = 0.2 + 0.09 * outline + 0.06 * turbulence  # How high the flame climbs at each place across.
    heat = np.clip(1 - b / np.maximum(0.04, reach), 0, 1) ** 1.35
    heat *= 0.78 + 0.22 * np.clip(turbulence + 0.5, 0, 1)
    picture = Image.fromarray((np.clip(_fire_colour(heat), 0, 1) * 255).astype(np.uint8)).resize(size, Image.BICUBIC)
    return picture.filter(ImageFilter.GaussianBlur(max(0.6, min(size) * 0.004)))


def fire_glow(n: int, total: int, size: tuple[int, int], rng=None) -> Image.Image:
    width, height = size
    sw, sh = max(16, width // 8), max(16, height // 8)
    y, x = np.mgrid[:sh, :sw].astype(np.float32)
    x, b = (x + 0.5) / sw, 1 - (y + 0.5) / sh
    t = n / FPS
    # Firelight never holds still: a few unrelated flickers, the glow's centre wandering a little across.
    flicker = 0.72 + 0.16 * math.sin(2 * math.pi * 7 * t / LOOP) + 0.08 * math.sin(2 * math.pi * 13 * t / LOOP + 1.1) + 0.05 * math.sin(2 * math.pi * 29 * t / LOOP + 2.3)
    centre = 0.5 + 0.12 * math.sin(2 * math.pi * 2 * t / LOOP)
    glow = np.exp(-b / 0.42) * np.exp(-((x - centre) / 0.65) ** 2) * flicker
    colour = np.array([1.0, 0.45, 0.12], np.float32)
    picture = np.clip(glow[..., None] * colour * 0.95, 0, 1)
    return Image.fromarray((picture * 255).astype(np.uint8)).resize(size, Image.BICUBIC)


SPARKS = 150


def spark_burst(n: int, total: int, size: tuple[int, int], rng=None) -> Image.Image:
    """A burst at the start (so it lands where it is placed), sparks flying out, arcing down and cooling within 1.8 s."""
    width, height = size
    unit = min(size)
    t = n / FPS
    image = Image.new('RGB', size)
    if t > 1.9:
        return image
    draw = ImageDraw.Draw(image)
    own = np.random.default_rng(11)  # The same burst every frame and every time: only the frame number moves it.
    angle = own.uniform(-math.pi * 0.95, -math.pi * 0.05, SPARKS)  # Upwards and outwards, as off an anvil.
    speed = own.uniform(0.25, 1.05, SPARKS) * unit
    life = own.uniform(0.5, 1.8, SPARKS)
    thick = own.uniform(0.6, 1.8, SPARKS)
    ox, oy = width * 0.5, height * 0.62
    gravity = 0.9 * unit
    for i in range(SPARKS):
        if t > life[i]:
            continue
        age = t / life[i]

        def at(s: float) -> tuple[float, float]:
            return ox + math.cos(angle[i]) * speed[i] * s, oy + math.sin(angle[i]) * speed[i] * s + 0.5 * gravity * s * s

        x, y = at(t)
        tx, ty = at(max(0.0, t - 0.035))  # A streak: a camera sees a fast spark as a short line.
        heat = (1 - age) ** 1.2
        colour = (int(255 * heat), int(205 * heat ** 1.4), int(120 * heat ** 2.5))
        draw.line((tx, ty, x, y), fill=colour, width=max(1, round(thick[i] * unit / 220)))
    sparks = np.asarray(image.filter(ImageFilter.GaussianBlur(max(0.4, unit * 0.0012))), np.float32)
    glow = np.asarray(image.filter(ImageFilter.GaussianBlur(max(2.0, unit * 0.008))), np.float32) * 1.6  # Hot sparks bloom a little.
    flash = max(0.0, 1 - t / 0.25) ** 2  # The strike itself: a soft hot bloom, gone in a quarter of a second.
    if flash > 0:
        yy, xx = np.mgrid[:height, :width].astype(np.float32)
        bloom = np.exp(-(((xx - ox) ** 2 + (yy - oy) ** 2) / (unit * 0.16) ** 2)) * flash
        sparks += bloom[..., None] * np.array([255, 190, 110], np.float32)
    return Image.fromarray(np.clip(sparks + glow, 0, 255).astype(np.uint8))


PAINTERS = {'flames': flames, 'fire-glow': fire_glow, 'spark-burst': spark_burst}
