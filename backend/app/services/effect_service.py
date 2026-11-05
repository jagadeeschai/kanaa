"""Special effects for celebrations and travel: confetti, a flower shower, sparkles, fireworks and more.

Each effect is drawn once, here, on black, as a short video in the shape of the project. The editor lays it over the
video on its own layer with the Screen blend, which drops the black and keeps the light. Preview and export already
draw overlays and Screen the same way, so an effect looks the same in both without any new shader or filter code.
Everything is made from code on this Mac: nothing is downloaded.
"""
from __future__ import annotations

import math
import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from app.core.config import settings
from app.db.database import get_connection
from app.services.job_service import JobCancelled

VERSION = 2  # Natural weather rendering; old generated media remains reusable in the library.
FPS = 30
SECONDS = 5.0
SHORT_SIDE = 720  # Soft light scales up well; this keeps making an effect to a few seconds.
FOLDER = 'Effects'


@dataclass(frozen=True)
class Effect:
    id: str
    label: str
    tamil: str
    mood: str  # celebration, wedding, festival, travel, any
    about: str


EFFECTS = [
    Effect('confetti', 'Confetti', 'வண்ணக் காகிதம்', 'celebration', 'Colourful paper falling and turning'),
    Effect('petals', 'Flower shower', 'பூ மழை', 'wedding', 'Marigold and rose petals drifting down'),
    Effect('sparkles', 'Sparkles', 'மின்னல்', 'celebration', 'Little stars that twinkle'),
    Effect('fireworks', 'Fireworks', 'பட்டாசு', 'festival', 'Bursts of light, for Diwali and new year'),
    Effect('bokeh', 'Bokeh lights', 'ஒளிப் புள்ளிகள்', 'wedding', 'Soft out-of-focus lights rising'),
    Effect('light-leak', 'Light leak', 'ஒளிக் கசிவு', 'travel', 'Warm film light drifting across'),
    Effect('film-burn', 'Film burn', 'ஃபிலிம் எரிவு', 'travel', 'A warm flash, good between two places'),
    Effect('snow', 'Snow', 'பனி', 'weather', 'Gentle depth-layered snow, for hills and winter trips'),
    Effect('rain', 'Rain', 'மழை', 'weather', 'Diagonal rain with a soft wet glow'),
    Effect('lightning', 'Lightning', 'மின்னல்', 'weather', 'A bright sky flash with a branching lightning bolt'),
    Effect('fog', 'Fog', 'மூடுபனி', 'weather', 'Soft banks of mist drifting across the frame'),
    Effect('dust', 'Dust', 'தூசி', 'travel', 'Warm floating dust caught in sunlight'),
    Effect('lens-flare', 'Lens flare', 'லென்ஸ் ஒளி', 'travel', 'A cinematic flare sweeping across the lens'),
]
BY_ID = {effect.id: effect for effect in EFFECTS}


def work_size(width: int, height: int) -> tuple[int, int]:
    scale = SHORT_SIDE / min(width, height)
    return max(2, round(width * scale / 2) * 2), max(2, round(height * scale / 2) * 2)


def weather_options(effect_id: str, raw: dict | None = None) -> dict:
    raw = raw or {}
    seed = max(0, min(99, int(raw.get('seed', 0))))
    if effect_id == 'rain':
        return {'density': max(0.25, min(2.0, float(raw.get('density', 1)))), 'direction': max(-1.0, min(1.0, float(raw.get('direction', -0.35)))), 'speed': max(0.6, min(1.6, float(raw.get('speed', 1)))), 'seed': seed}
    if effect_id == 'lightning':
        return {'frequency': max(1, min(6, int(raw.get('frequency', 3)))), 'brightness': max(0.25, min(1.5, float(raw.get('brightness', 1)))), 'seed': seed}
    if effect_id == 'fog':
        return {'density': max(0.2, min(1.25, float(raw.get('density', 0.65)))), 'speed': max(0.2, min(1.4, float(raw.get('speed', 0.55)))), 'direction': max(-1.0, min(1.0, float(raw.get('direction', 0.35)))), 'seed': seed}
    if effect_id == 'snow':
        return {'density': max(0.25, min(1.75, float(raw.get('density', 0.8)))), 'speed': max(0.4, min(1.5, float(raw.get('speed', 0.8)))), 'direction': max(-1.0, min(1.0, float(raw.get('direction', 0.12)))), 'seed': seed}
    return {}


def effect_path(effect_id: str, size: tuple[int, int], options: dict | None = None) -> Path:
    config = weather_options(effect_id, options)
    variant = f'-{hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:10]}' if config else ''
    return settings.data_dir / 'effects' / f'{effect_id}-{size[0]}x{size[1]}{variant}-v{VERSION}.mp4'


# Each painter draws frame `n` of `total` onto a black RGB image of `size` and returns it.
Painter = Callable[[int, int, tuple[int, int], np.random.Generator], Image.Image]
ConfettiColours = [(255, 77, 109), (255, 200, 61), (72, 202, 228), (124, 92, 255), (82, 214, 129), (255, 140, 66)]


def _particles(rng: np.random.Generator, count: int, **ranges: tuple[float, float]) -> dict[str, np.ndarray]:
    return {name: rng.uniform(low, high, count) for name, (low, high) in ranges.items()}


def _glow(image: Image.Image, radius: float, strength: float = 1.0) -> Image.Image:
    """Adds a soft halo: the picture plus a blurred copy of itself."""
    halo = np.asarray(image.filter(ImageFilter.GaussianBlur(radius)), np.float32) * strength
    return Image.fromarray(np.clip(np.asarray(image, np.float32) + halo, 0, 255).astype(np.uint8))


def falling(colours, count, size_range, sway, spin, shape):
    def paint(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
        width, height = size
        unit = min(width, height)
        p = paint.cache.get(size)
        if p is None:
            p = paint.cache[size] = {**_particles(rng, count, x=(0, 1), phase=(0, 1), speed=(0.18, 0.32), size=size_range, turn=(0, 6.28), wobble=(0.5, 1.5)),
                                     'colour': rng.integers(0, len(colours), count)}
        image = Image.new('RGB', size)
        draw = ImageDraw.Draw(image)
        t = n / FPS
        for i in range(count):
            # Each piece loops top to bottom, so the effect can be any length and starts already falling.
            y = ((p['phase'][i] + t * p['speed'][i]) % 1.15) - 0.075
            x = p['x'][i] + sway * math.sin(t * p['wobble'][i] * 2 + p['turn'][i])
            s = p['size'][i] * unit
            angle = p['turn'][i] + t * spin * p['wobble'][i]
            squash = abs(math.cos(angle * 1.7)) * 0.8 + 0.2  # Turning over in the air.
            cx, cy = x * width, y * height
            if shape == 'rect':
                points = [(-s, -s * 0.5), (s, -s * 0.5), (s, s * 0.5), (-s, s * 0.5)]
            else:
                points = [(s * math.cos(a), s * 0.55 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
            c, si = math.cos(angle), math.sin(angle)
            draw.polygon([(cx + (px * c - py * si) * squash, cy + px * si + py * c) for px, py in points], fill=colours[p['colour'][i]])
        return image
    paint.cache = {}
    return paint


def sparkles(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    p = sparkles.cache.get(size)
    if p is None:
        p = sparkles.cache[size] = _particles(rng, 70, x=(0, 1), y=(0, 1), phase=(0, 6.28), rate=(1.5, 4), size=(0.006, 0.016))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    unit = min(width, height)
    for i in range(len(p['x'])):
        light = max(0.0, math.sin(t * p['rate'][i] + p['phase'][i])) ** 3
        if light < 0.05:
            continue
        cx, cy, s = p['x'][i] * width, p['y'][i] * height, p['size'][i] * unit * (0.5 + light)
        colour = tuple(int(c * light) for c in (255, 236, 190))
        draw.polygon([(cx, cy - s * 2), (cx + s * 0.3, cy - s * 0.3), (cx + s * 2, cy), (cx + s * 0.3, cy + s * 0.3), (cx, cy + s * 2), (cx - s * 0.3, cy + s * 0.3), (cx - s * 2, cy), (cx - s * 0.3, cy - s * 0.3)], fill=colour)
    return _glow(image, unit * 0.01, 1.4)


sparkles.cache = {}


def fireworks(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(width, height)
    bursts = fireworks.cache.get(size)
    if bursts is None:
        bursts = fireworks.cache[size] = [{'at': i * 0.62 + rng.uniform(0, 0.3), 'x': rng.uniform(0.15, 0.85), 'y': rng.uniform(0.12, 0.5),
                                           'colour': ConfettiColours[int(rng.integers(0, len(ConfettiColours)))], 'angles': rng.uniform(0, 6.28, 60), 'speeds': rng.uniform(0.6, 1.0, 60)}
                                          for i in range(8)]
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for burst in bursts:
        age = t - burst['at']
        if not 0 <= age < 1.6:
            continue
        fade = (1 - age / 1.6) ** 1.5
        reach = 0.22 * unit * (1 - math.exp(-age * 3))
        colour = tuple(int(c * fade) for c in burst['colour'])
        for angle, speed in zip(burst['angles'], burst['speeds']):
            x = burst['x'] * width + math.cos(angle) * reach * speed
            y = burst['y'] * height + math.sin(angle) * reach * speed + 0.05 * unit * age * age  # Sparks fall a little.
            r = max(1.0, unit * 0.004 * fade + 1)
            draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)
    return _glow(image, unit * 0.012, 1.6)


fireworks.cache = {}


def bokeh(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(width, height)
    p = bokeh.cache.get(size)
    if p is None:
        p = bokeh.cache[size] = {**_particles(rng, 28, x=(0, 1), phase=(0, 1.3), speed=(0.03, 0.08), size=(0.03, 0.08), drift=(0, 6.28), light=(0.35, 0.8)),
                                 'colour': rng.integers(0, 3, 28)}
    colours = [(255, 196, 120), (255, 150, 170), (255, 236, 200)]
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in range(len(p['x'])):
        y = 1.15 - ((p['phase'][i] + t * p['speed'][i]) % 1.3)
        x = p['x'][i] + 0.02 * math.sin(t * 0.7 + p['drift'][i])
        r = p['size'][i] * unit
        colour = tuple(int(c * p['light'][i]) for c in colours[p['colour'][i]])
        draw.ellipse([x * width - r, y * height - r, x * width + r, y * height + r], fill=colour)
    return image.filter(ImageFilter.GaussianBlur(unit * 0.008))


bokeh.cache = {}


def _field(size: tuple[int, int], blobs: list[tuple[float, float, float, tuple[int, int, int], float]]) -> Image.Image:
    """Soft round light, worked out small and scaled up, as light leaks are smooth anyway."""
    width, height = size
    small = (max(8, width // 8), max(8, height // 8))
    ys, xs = np.mgrid[0:small[1], 0:small[0]].astype(np.float32)
    xs /= small[0]; ys /= small[1]
    picture = np.zeros((small[1], small[0], 3), np.float32)
    aspect = width / height
    for x, y, radius, colour, strength in blobs:
        weight = np.exp(-(((xs - x) * aspect) ** 2 + (ys - y) ** 2) / (radius * radius)) * strength
        picture += weight[..., None] * np.array(colour, np.float32)
    return Image.fromarray(np.clip(picture, 0, 255).astype(np.uint8)).resize(size, Image.BICUBIC)


def light_leak(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    t = n / max(1, total - 1)
    rise = math.sin(math.pi * t)  # In and out again, so it can sit anywhere.
    return _field(size, [(-0.1 + 0.5 * t, 0.3, 0.45, (255, 120, 40), 0.9 * rise), (0.15 + 0.4 * t, 0.75, 0.35, (255, 70, 90), 0.6 * rise),
                         (1.05 - 0.3 * t, 0.15, 0.3, (255, 210, 120), 0.7 * rise)])


def film_burn(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    t = n / FPS
    # A quick flare in the middle of the effect: up in half a second, gone a second later.
    middle = SECONDS / 2
    rise = math.exp(-((t - middle) / 0.45) ** 2)
    return _field(size, [(0.85 - 0.3 * (t / SECONDS), 0.5, 0.5, (255, 110, 30), 1.2 * rise), (0.6, 0.45, 0.25, (255, 240, 200), 1.4 * rise ** 2),
                         (0.2, 0.9, 0.4, (200, 40, 20), 0.6 * rise)])


def rain(n: int, total: int, size: tuple[int, int], rng: np.random.Generator, density: float = 1, direction: float = -0.35, speed: float = 1, seed: int = 0) -> Image.Image:
    """Layered rain: many soft distant drops and fewer sharp foreground streaks."""
    width, height = size
    unit = min(width, height)
    key = (*size, round(density, 2), round(direction, 2), round(speed, 2), seed)
    drops = rain.cache.get(key)
    if drops is None:
        drops = rain.cache[key] = {**_particles(rng, round(520 * density), x=(-0.2, 1.2), phase=(0, 1), fall=(0.55, 1.7), length=(0.012, 0.055), light=(0.12, 0.62), depth=(0, 1))}
    distant = Image.new('RGB', size)
    near = Image.new('RGB', size)
    far_draw, near_draw = ImageDraw.Draw(distant), ImageDraw.Draw(near)
    t = n / FPS
    for i in range(len(drops['x'])):
        y = ((drops['phase'][i] + t * drops['fall'][i] * speed) % 1.15) - 0.08
        depth = drops['depth'][i]
        length = drops['length'][i] * unit * (0.45 + depth * 0.9)
        x = (drops['x'][i] + y * direction * 0.35) * width
        shade = int(155 * drops['light'][i] * (0.55 + depth * 0.65))
        draw = near_draw if depth > 0.72 else far_draw
        draw.line((x, y * height, x - length * direction * 0.45, y * height + length), fill=(shade * 4 // 5, shade * 9 // 10, shade), width=max(1, round(length / 38)))
    distant = distant.filter(ImageFilter.GaussianBlur(max(0.45, unit * 0.0014)))
    return Image.fromarray(np.clip(np.asarray(distant, np.int16) + np.asarray(near, np.int16), 0, 255).astype(np.uint8))


rain.cache = {}


def lightning(n: int, total: int, size: tuple[int, int], rng: np.random.Generator, frequency: int = 3, brightness: float = 1, seed: int = 0) -> Image.Image:
    """Two repeatable lightning strikes with a quick double flash and a branching bolt."""
    width, height = size
    unit = min(width, height)
    t = n / FPS
    strikes = tuple(np.linspace(0.75, max(0.8, SECONDS - 0.65), frequency))
    strength = max((math.exp(-((t - at) / 0.055) ** 2) + 0.5 * math.exp(-((t - at - 0.16) / 0.04) ** 2) for at in strikes), default=0.0)
    image = Image.new('RGB', size, tuple(int(min(255, c * min(1, strength * 0.52) * brightness)) for c in (150, 175, 255)))
    nearest = min(strikes, key=lambda at: abs(t - at))
    if abs(t - nearest) > 0.22:
        return image
    # Seed by the strike, not the frame, so the bolt holds still while it flashes.
    bolt_rng = np.random.default_rng(round(nearest * 1000) + seed * 10007)
    points = [(width * bolt_rng.uniform(0.35, 0.72), -unit * 0.02)]
    while points[-1][1] < height * 0.82:
        x, y = points[-1]
        points.append((x + bolt_rng.uniform(-0.09, 0.09) * width, y + bolt_rng.uniform(0.07, 0.14) * height))
    bolt = Image.new('RGB', size)
    draw = ImageDraw.Draw(bolt)
    bolt_light = max(0.18, min(1.0, strength * brightness))
    draw.line(points, fill=tuple(int(c * bolt_light) for c in (225, 235, 255)), width=max(1, round(unit * 0.006)), joint='curve')
    for branch_at in (2, 4):
        if branch_at >= len(points) - 1:
            continue
        x, y = points[branch_at]
        branch = [(x, y)]
        for _ in range(3):
            x += bolt_rng.uniform(-0.12, 0.12) * width
            y += bolt_rng.uniform(0.05, 0.1) * height
            branch.append((x, y))
        draw.line(branch, fill=tuple(int(c * bolt_light * 0.7) for c in (210, 225, 255)), width=max(1, round(unit * 0.003)))
    return Image.fromarray(np.clip(np.asarray(image, np.float32) + np.asarray(_glow(bolt, unit * 0.018, 1.8), np.float32), 0, 255).astype(np.uint8))


def fog(n: int, total: int, size: tuple[int, int], rng: np.random.Generator, density: float = 0.65, speed: float = 0.55, direction: float = 0.35, seed: int = 0) -> Image.Image:
    """Low-frequency textured mist, kept translucent enough to preserve the underlying shot."""
    width, height = size
    small = (max(24, width // 12), max(16, height // 12))
    key = (*small, seed)
    texture = fog.cache.get(key)
    if texture is None:
        noise_rng = np.random.default_rng(7129 + seed * 101)
        noise = Image.fromarray(noise_rng.integers(0, 256, (small[1], small[0]), dtype=np.uint8), 'L')
        texture = fog.cache[key] = np.asarray(noise.filter(ImageFilter.GaussianBlur(max(2, small[1] * 0.11))), np.float32) / 255
    shift = round((n / FPS) * speed * direction * small[0] * 0.08)
    cloud = np.roll(texture, shift, axis=1)
    # Uneven bands keep it from looking like a flat grey veil.
    ys = np.linspace(0, 1, small[1], dtype=np.float32)[:, None]
    bands = 0.76 + 0.12 * np.sin(ys * 8 + n / FPS * speed * 0.24) + 0.07 * np.sin(ys * 19 - 0.8)
    alpha = np.clip((cloud - 0.34) * 1.55 * bands * density, 0, 0.42)
    colour = np.array([225, 232, 234], np.float32)
    picture = np.clip(alpha[..., None] * colour, 0, 255).astype(np.uint8)
    return Image.fromarray(picture).resize(size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(max(1, min(size) * 0.008)))


fog.cache = {}


def snow(n: int, total: int, size: tuple[int, int], rng: np.random.Generator, density: float = 0.8, speed: float = 0.8, direction: float = 0.12, seed: int = 0) -> Image.Image:
    """Round, depth-layered flakes with gentle wind and softly blurred distant snow."""
    width, height = size
    unit = min(size)
    key = (*size, round(density, 2), round(speed, 2), round(direction, 2), seed)
    flakes = snow.cache.get(key)
    if flakes is None:
        flakes = snow.cache[key] = _particles(rng, round(230 * density), x=(-0.08, 1.08), phase=(0, 1.1), fall=(0.025, 0.12), size=(0.0012, 0.0055), sway=(0, 6.28), depth=(0, 1))
    distant = Image.new('RGB', size)
    near = Image.new('RGB', size)
    far_draw, near_draw = ImageDraw.Draw(distant), ImageDraw.Draw(near)
    t = n / FPS
    for i in range(len(flakes['x'])):
        depth = flakes['depth'][i]
        y = ((flakes['phase'][i] + t * flakes['fall'][i] * speed * (0.55 + depth)) % 1.15) - 0.08
        x = flakes['x'][i] + t * direction * 0.035 * (0.4 + depth) + math.sin(t * (0.7 + depth) + flakes['sway'][i]) * 0.012
        radius = flakes['size'][i] * unit * (0.45 + depth)
        shade = round(135 + depth * 95)
        draw = near_draw if depth > 0.68 else far_draw
        draw.ellipse((x * width - radius, y * height - radius, x * width + radius, y * height + radius), fill=(shade, shade, min(255, shade + 8)))
    distant = distant.filter(ImageFilter.GaussianBlur(max(0.6, unit * 0.002)))
    return Image.fromarray(np.clip(np.asarray(distant, np.int16) + np.asarray(near, np.int16), 0, 255).astype(np.uint8))


snow.cache = {}


def dust(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    particles = dust.cache.get(size)
    if particles is None:
        particles = dust.cache[size] = _particles(rng, 120, x=(0, 1), y=(0, 1), phase=(0, 6.28), speed=(0.018, 0.07), size=(0.001, 0.0045), light=(0.25, 0.85))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in range(len(particles['x'])):
        x = (particles['x'][i] + t * particles['speed'][i] + 0.018 * math.sin(t + particles['phase'][i])) % 1.04 - 0.02
        y = (particles['y'][i] - t * particles['speed'][i] * 0.35) % 1.04 - 0.02
        pulse = 0.45 + 0.55 * max(0, math.sin(t * 1.7 + particles['phase'][i]))
        radius = particles['size'][i] * unit * (0.7 + pulse)
        light = particles['light'][i] * pulse
        colour = (int(255 * light), int(205 * light), int(125 * light))
        draw.ellipse((x * width - radius, y * height - radius, x * width + radius, y * height + radius), fill=colour)
    return _glow(image, max(1, unit * 0.004), 0.8)


dust.cache = {}


def lens_flare(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    t = n / max(1, total - 1)
    x, y = (-0.08 + 1.16 * t) * width, (0.28 + 0.10 * math.sin(t * math.pi)) * height
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    for radius, colour in ((0.018, (255, 250, 220)), (0.045, (255, 185, 105)), (0.09, (160, 95, 255))):
        r = unit * radius
        draw.ellipse((x - r, y - r, x + r, y + r), fill=colour)
    for amount, radius, colour in ((0.35, 0.026, (80, 120, 210)), (0.55, 0.042, (180, 75, 80)), (0.78, 0.018, (90, 190, 170))):
        gx, gy = x + (width / 2 - x) * amount * 2, y + (height / 2 - y) * amount * 2
        r = unit * radius
        draw.ellipse((gx - r, gy - r, gx + r, gy + r), outline=colour, width=max(1, round(unit * 0.004)))
    return _glow(image, max(2, unit * 0.035), 1.7)


EFFECT_PAINTERS: dict[str, Painter] = {
    'confetti': falling(ConfettiColours, 110, (0.011, 0.022), 0.03, 3.0, 'rect'),
    'petals': falling([(255, 153, 0), (255, 196, 0), (230, 40, 70), (255, 110, 150)], 80, (0.017, 0.03), 0.05, 1.2, 'petal'),
    'snow': snow,
    'rain': rain,
    'lightning': lightning,
    'fog': fog,
    'dust': dust,
    'lens-flare': lens_flare,
    'sparkles': sparkles,
    'fireworks': fireworks,
    'bokeh': bokeh,
    'light-leak': light_leak,
    'film-burn': film_burn,
}


def render_effect(effect_id: str, size: tuple[int, int], target: Path, on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False, options: dict | None = None) -> Path:
    paint = EFFECT_PAINTERS[effect_id]
    config = weather_options(effect_id, options)
    rng = np.random.default_rng(sum(map(ord, effect_id)) + int(config.get('seed', 0)) * 1009)
    total = round(SECONDS * FPS)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix('.part.mp4')
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{size[0]}x{size[1]}', '-r', str(FPS), '-i', '-',
                                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(partial)], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        assert process.stdin is not None
        for n in range(total):
            if should_cancel():
                raise JobCancelled()
            frame = paint(n, total, size, rng, **config) if effect_id in {'rain', 'lightning', 'fog', 'snow'} else paint(n, total, size, rng)
            process.stdin.write(frame.convert('RGB').tobytes())
            on_progress(min(95, (n + 1) * 95 // total))
        process.stdin.close()
        if process.wait(timeout=120):
            raise RuntimeError('Could not make this effect.')
    except BaseException:
        process.kill()
        partial.unlink(missing_ok=True)
        raise
    partial.replace(target)
    return target


def file_into_effects_folder(media_id: int) -> None:
    with get_connection() as conn:
        conn.execute('INSERT OR IGNORE INTO media_folders(name) VALUES (?)', (FOLDER,))
        conn.execute('UPDATE photos SET folder=? WHERE id=?', (FOLDER, media_id))
        conn.commit()


def existing_media(path: Path) -> int | None:
    with get_connection() as conn:
        row = conn.execute('SELECT id FROM photos WHERE absolute_path=? ORDER BY id DESC LIMIT 1', (str(path.resolve()),)).fetchone()
    return row['id'] if row and path.is_file() else None
