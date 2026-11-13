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
EFFECT_VERSIONS = {'anamorphic': 3}  # Regenerate only effects whose renderer changed independently.
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
    placement: str = 'overlay'  # overlay: Screen-blended on the Effects layer. start: an opaque clip opening the main track.


EFFECTS = [
    Effect('confetti', 'Confetti', 'வண்ணக் காகிதம்', 'celebration', 'Colourful paper falling and turning'),
    Effect('petals', 'Flower shower', 'பூ மழை', 'wedding', 'Marigold and rose petals drifting down'),
    Effect('jasmine', 'Jasmine shower', 'மல்லிகை மழை', 'wedding', 'Small white jasmine buds falling gently'),
    Effect('akshatai', 'Rice and turmeric', 'அட்சதை', 'wedding', 'Blessed yellow rice grains arc upwards and fall'),
    Effect('thoranam', 'Thoranam', 'தோரணம்', 'wedding', 'Mango leaves and marigolds swaying gently across the top'),
    Effect('diya', 'Diya glow', 'தீப ஒளி', 'festival', 'A row of oil-lamp flames flickering along the bottom'),
    Effect('incense-smoke', 'Camphor and incense smoke', 'கற்பூர தூபப் புகை', 'festival', 'Soft fragrant smoke curling upwards for aarti and temple scenes'),
    Effect('embers', 'Rising embers', 'எழும் தீப்பொறிகள்', 'festival', 'Glowing sparks drifting up from a fire, for Bhogi and night scenes'),
    Effect('rangoli-border', 'Rangoli border', 'ரங்கோலி ஓரம்', 'festival', 'Flowers and dots drawing themselves round the edge'),
    Effect('bubbles', 'Bubbles', 'குமிழிகள்', 'celebration', 'Soap bubbles rising with a rainbow sheen; some pop'),
    Effect('night-sky', 'Night sky', 'இரவு வானம்', 'travel', 'Twinkling stars and the odd shooting star'),
    Effect('callout-circle', 'Circle callout', 'வட்டக் குறி', 'vlog', 'A hand-drawn circle; move and size it over what matters'),
    Effect('callout-arrow', 'Arrow callout', 'அம்புக் குறி', 'vlog', 'A hand-drawn arrow pointing at the middle; move it to aim'),
    Effect('speed-lines', 'Speed lines', 'வேகக் கோடுகள்', 'vlog', 'Comic streaks rushing to the middle, for fast or funny moments'),
    Effect('countdown', 'Film countdown', 'எண்ணிக்கை தொடக்கம்', 'vlog', 'An old film leader counting 5 to 2, with its beep, to open the video', placement='start'),
    Effect('sparkler', 'Sparkler trails', 'மத்தாப்பு', 'festival', 'A bright hand-sparkler scattering lively trails'),
    Effect('kolam', 'Kolam reveal', 'கோலம்', 'festival', 'A dot kolam draws itself in white light'),
    Effect('sparkles', 'Sparkles', 'மின்னல்', 'celebration', 'Little stars that twinkle'),
    Effect('balloons', 'Balloons rising', 'பலூன்கள்', 'celebration', 'Soft glossy balloons floating upwards'),
    Effect('glitter-burst', 'Glitter burst', 'மினுமினுப்பு', 'celebration', 'A quick golden burst for a title or transition'),
    Effect('hearts', 'Hearts', 'இதயங்கள்', 'celebration', 'Soft hearts drifting upwards for weddings and anniversaries'),
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
    Effect('sun-rays', 'Sun rays', 'சூரியக் கதிர்கள்', 'travel', 'Soft beams drifting from one corner'),
    Effect('prism-leak', 'Prism leak', 'வானவில் ஒளி', 'travel', 'A thin rainbow edge moving across the frame'),
    Effect('anamorphic', 'Anamorphic streaks', 'நீல ஒளிக் கோடுகள்', 'travel', 'Fine blue horizontal cinematic flares'),
    Effect('light-flicker', 'Light flicker', 'ஒளித் துடிப்பு', 'travel', 'Gentle old-projector brightness variation'),
    Effect('fireflies', 'Fireflies', 'மின்மினிப் பூச்சிகள்', 'travel', 'Slow green-gold lights blinking through an evening scene'),
    Effect('lanterns', 'Floating lanterns', 'வான விளக்குகள்', 'travel', 'Warm sky lanterns drifting up and away'),
    Effect('leaves', 'Falling leaves', 'உதிரும் இலைகள்', 'travel', 'Depth-layered leaves turning gently as they fall'),
    Effect('caustics', 'Water caustics', 'நீர் ஒளி அலைகள்', 'travel', 'Soft moving light patterns for water and boats'),
    Effect('shine', 'Shine sweep', 'மின்னும் ஒளிக்கோடு', 'any', 'A bright streak of light passing across, twice; lay it over a title'),
    Effect('sea-sparkle', 'Sea sparkle', 'கடல் மினுமினுப்பு', 'travel', 'Sun glints dancing across the water'),
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
    return settings.data_dir / 'effects' / f'{effect_id}-{size[0]}x{size[1]}{variant}-v{EFFECT_VERSIONS.get(effect_id, VERSION)}.mp4'


# Each painter draws frame `n` of `total` onto a black RGB image of `size` and returns it.
Painter = Callable[[int, int, tuple[int, int], np.random.Generator], Image.Image]
ConfettiColours = [(255, 77, 109), (255, 200, 61), (72, 202, 228), (124, 92, 255), (82, 214, 129), (255, 140, 66)]


def _particles(rng: np.random.Generator, count: int, **ranges: tuple[float, float]) -> dict[str, np.ndarray]:
    return {name: rng.uniform(low, high, count) for name, (low, high) in ranges.items()}


def _glow(image: Image.Image, radius: float, strength: float = 1.0) -> Image.Image:
    """Adds a soft halo: the picture plus a blurred copy of itself."""
    halo = np.asarray(image.filter(ImageFilter.GaussianBlur(radius)), np.float32) * strength
    return Image.fromarray(np.clip(np.asarray(image, np.float32) + halo, 0, 255).astype(np.uint8))


def shine(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """A slanted streak of light crossing from left to right in the first second of every two and a half, then dark."""
    width, height = size
    t = (n / FPS) % 2.5
    image = Image.new('RGB', size)
    if t > 1.0:
        return image
    ease = t * t * (3 - 2 * t)
    centre = -0.3 * width + ease * 1.6 * width
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    slant = xs + (ys - height / 2) * 0.45  # Leaning, like light caught on glass.
    band = np.exp(-((slant - centre) / (0.035 * width)) ** 2)
    core = np.exp(-((slant - centre) / (0.008 * width)) ** 2)
    light = np.clip(band * 150 + core * 140, 0, 255)
    rgb = np.stack([light, light * 0.97, light * 0.88], axis=-1).astype(np.uint8)  # A little warm, like gold leaf.
    return Image.fromarray(rgb)


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


def thoranam(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """A layered mango-leaf and marigold garland with independent, restrained movement."""
    width, height = size
    unit = min(size)
    count = max(9, round(width / unit * 10))
    t = n / FPS
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    rope_y = unit * .038
    sag = unit * .025
    rope = []
    for step in range(81):
        x = width * step / 80
        y = rope_y + sag * math.sin(math.pi * step / 80) + math.sin(t * .65 + step * .12) * unit * .0015
        rope.append((x, y))
    draw.line(rope, fill=(158, 105, 35), width=max(2, round(unit * .004)))
    for i in range(count):
        x = width * (i + .5) / count
        share = (i + .5) / count
        anchor_y = rope_y + sag * math.sin(math.pi * share)
        phase = i * 1.73
        swing = math.sin(t * .9 + phase) * .11 + math.sin(t * .37 + phase * .7) * .035
        length = unit * (.105 + .018 * math.sin(i * 2.1))
        tip_x = x + math.sin(swing) * length
        tip_y = anchor_y + math.cos(swing) * length
        normal_x, normal_y = math.cos(swing), -math.sin(swing)
        half = unit * (.018 + .003 * (i % 3))
        leaf = [(x, anchor_y), (x + normal_x * half, anchor_y + normal_y * half + length * .28),
                (tip_x + normal_x * half * .18, tip_y + normal_y * half * .18), (tip_x, tip_y + unit * .012),
                (tip_x - normal_x * half * .18, tip_y - normal_y * half * .18),
                (x - normal_x * half, anchor_y - normal_y * half + length * .28)]
        green = (40 + (i % 3) * 8, 128 + (i % 2) * 22, 52 + (i % 4) * 5)
        draw.polygon(leaf, fill=green)
        draw.line((x, anchor_y, tip_x, tip_y), fill=(112, 178, 75), width=max(1, round(unit * .0015)))
        flower_x = width * (i + 1) / count
        flower_y = rope_y + sag * math.sin(math.pi * min(1, (i + 1) / count)) + unit * .008
        flower_y += math.sin(t * .8 + phase) * unit * .002
        radius = unit * (.011 if i % 2 else .014)
        for petal in range(8):
            angle = petal * math.pi / 4 + t * .08 * (-1 if i % 2 else 1)
            px, py = flower_x + math.cos(angle) * radius * .55, flower_y + math.sin(angle) * radius * .55
            r = radius * .55
            draw.ellipse((px - r, py - r, px + r, py + r), fill=(238, 133 + (i % 2) * 35, 20))
        draw.ellipse((flower_x - radius * .45, flower_y - radius * .45, flower_x + radius * .45, flower_y + radius * .45), fill=(255, 196, 38))
    return _glow(image, max(.6, unit * .0015), .12)


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


def incense_smoke(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """Fine layered plumes that curl upward from below, unlike broad horizontal weather fog."""
    width, height = size
    unit = min(size)
    t = n / FPS
    plumes = incense_smoke.cache.get(size)
    if plumes is None:
        plumes = incense_smoke.cache[size] = [
            {'x': x, 'phase': phase, 'rate': rate, 'lean': lean, 'width': stroke}
            for x, phase, rate, lean, stroke in zip(
                rng.uniform(.18, .82, 7), rng.uniform(0, 1, 7), rng.uniform(.055, .09, 7),
                rng.uniform(-.035, .035, 7), rng.uniform(.010, .020, 7))]
    far = Image.new('L', size)
    near = Image.new('L', size)
    far_draw, near_draw = ImageDraw.Draw(far), ImageDraw.Draw(near)
    for index, plume in enumerate(plumes):
        progress = (plume['phase'] + t * plume['rate']) % 1.18
        # Each plume occupies only part of the cycle: it grows, thins and disappears before looping.
        length = min(1, progress / .22) * max(0, 1 - max(0, progress - .78) / .4)
        if length <= .02:
            continue
        points = []
        segments = 34
        for step in range(segments):
            share = step / (segments - 1) * length
            y = 1.06 - share * .72
            curl = math.sin(share * 8.5 + t * .72 + index * 1.9) * (.012 + share * .035)
            curl += math.sin(share * 18 - t * .31 + index) * share * .009
            x = plume['x'] + plume['lean'] * share + curl
            points.append((x * width, y * height))
        fade = max(.16, 1 - progress * .62)
        value = round(150 * fade)
        line_width = max(3, round(plume['width'] * unit * (1.5 + progress)))
        target = near_draw if index % 3 else far_draw
        target.line(points, fill=value, width=line_width, joint='curve')
        # A fainter neighbouring filament breaks the computer-perfect centre line into a soft ribbon.
        echo = [(x + math.sin(step * .43 + index) * unit * .009, y) for step, (x, y) in enumerate(points)]
        target.line(echo, fill=round(value * .42), width=max(2, line_width // 2), joint='curve')
    far = far.filter(ImageFilter.GaussianBlur(max(3, unit * .036)))
    near = near.filter(ImageFilter.GaussianBlur(max(2, unit * .019)))
    smoke = np.asarray(far, np.float32) * .68 + np.asarray(near, np.float32)
    picture = np.zeros((height, width, 3), np.float32)
    picture[..., 0] = smoke * .94
    picture[..., 1] = smoke * .97
    picture[..., 2] = smoke
    # A small camphor warmth at the source grounds the otherwise cool-white smoke.
    glow = _field(size, [(.5, 1.04, .12, (255, 133, 45), .16 + .03 * math.sin(t * 4.1))])
    picture += np.asarray(glow, np.float32)
    return Image.fromarray(np.clip(picture, 0, 255).astype(np.uint8))


incense_smoke.cache = {}


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


def jasmine(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    buds = jasmine.cache.get(size)
    if buds is None:
        buds = jasmine.cache[size] = _particles(rng, 78, x=(-0.03, 1.03), phase=(0, 1.15), fall=(0.065, 0.13), size=(0.0035, 0.008), sway=(0, 6.28), spin=(0, 6.28))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in range(len(buds['x'])):
        y = ((buds['phase'][i] + t * buds['fall'][i]) % 1.18) - 0.08
        x = buds['x'][i] + 0.025 * math.sin(t * 0.8 + buds['sway'][i])
        radius = buds['size'][i] * unit
        angle = buds['spin'][i] + t * 0.45
        cx, cy = x * width, y * height
        for petal in range(3):
            a = angle + petal * math.tau / 3
            px, py = cx + math.cos(a) * radius * 0.55, cy + math.sin(a) * radius * 0.55
            draw.ellipse((px - radius * 0.62, py - radius * 0.46, px + radius * 0.62, py + radius * 0.46), fill=(238, 235, 218))
        draw.ellipse((cx - radius * 0.24, cy - radius * 0.24, cx + radius * 0.24, cy + radius * 0.24), fill=(255, 250, 226))
    return _glow(image, max(0.5, unit * 0.0015), 0.35)


jasmine.cache = {}


def akshatai(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    grains = akshatai.cache.get(size)
    if grains is None:
        grains = akshatai.cache[size] = _particles(rng, 140, delay=(0, 2.2), x=(-0.12, 0.12), vx=(-0.32, 0.32), vy=(0.55, 0.95), gravity=(0.42, 0.58), size=(0.002, 0.005), turn=(0, 6.28))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in range(len(grains['x'])):
        age = (t - grains['delay'][i]) % 2.2
        if age > 1.75:
            continue
        x = 0.5 + grains['x'][i] + grains['vx'][i] * age
        y = 1.04 - grains['vy'][i] * age + grains['gravity'][i] * age * age
        length = grains['size'][i] * unit * 2.8
        angle = grains['turn'][i] + age * 5
        dx, dy = math.cos(angle) * length, math.sin(angle) * length
        shade = (245, 196 + int(35 * (i % 3) / 2), 45)
        draw.line((x * width - dx, y * height - dy, x * width + dx, y * height + dy), fill=shade, width=max(1, round(length * 0.55)))
    return _glow(image, max(0.5, unit * 0.001), 0.25)


akshatai.cache = {}


def diya(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    count = max(5, min(11, round(width / height * 7)))
    for i in range(count):
        x = width * (i + 1) / (count + 1)
        base = height * 0.93
        bowl_w, bowl_h = unit * 0.055, unit * 0.018
        draw.polygon(((x - bowl_w, base - bowl_h), (x + bowl_w, base - bowl_h), (x + bowl_w * 0.62, base + bowl_h), (x - bowl_w * 0.62, base + bowl_h)), fill=(155, 72, 12))
        draw.line((x - bowl_w, base - bowl_h, x + bowl_w, base - bowl_h), fill=(255, 183, 45), width=max(1, round(unit * 0.004)))
        flicker = 0.88 + 0.12 * math.sin(t * (7.5 + i * 0.17) + i * 1.9) + 0.05 * math.sin(t * 18 + i)
        flame_h, flame_w = unit * 0.085 * flicker, unit * 0.024
        draw.polygon(((x, base - bowl_h - flame_h), (x + flame_w, base - bowl_h - flame_h * 0.3), (x, base - bowl_h), (x - flame_w, base - bowl_h - flame_h * 0.3)), fill=(255, 132, 22))
        inner_h = flame_h * 0.58
        draw.polygon(((x, base - bowl_h - inner_h), (x + flame_w * 0.42, base - bowl_h - inner_h * 0.25), (x, base - bowl_h), (x - flame_w * 0.42, base - bowl_h - inner_h * 0.25)), fill=(255, 245, 166))
    return _glow(image, max(2, unit * 0.025), 1.25)


def sparkler(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    sparks = sparkler.cache.get(size)
    if sparks is None:
        sparks = sparkler.cache[size] = _particles(rng, 150, born=(0, 1), angle=(0, 6.28), speed=(0.06, 0.24), life=(0.22, 0.9), size=(0.001, 0.0035))
    t = n / FPS
    cx = width * (0.62 + 0.035 * math.sin(t * 0.8))
    cy = height * (0.52 + 0.025 * math.sin(t * 1.1))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    draw.line((cx + unit * 0.01, cy + unit * 0.01, cx + unit * 0.18, cy + unit * 0.28), fill=(110, 95, 75), width=max(1, round(unit * 0.004)))
    for i in range(len(sparks['born'])):
        age = (t + sparks['born'][i]) % 1.0
        if age > sparks['life'][i]:
            continue
        fade = 1 - age / sparks['life'][i]
        distance = sparks['speed'][i] * unit * age * 5
        gravity = unit * 0.13 * age * age
        x = cx + math.cos(sparks['angle'][i]) * distance
        y = cy + math.sin(sparks['angle'][i]) * distance + gravity
        trail = max(2, distance * 0.22)
        colour = (round(255 * fade), round((205 + 45 * fade) * fade), round(115 * fade))
        draw.line((x, y, x - math.cos(sparks['angle'][i]) * trail, y - math.sin(sparks['angle'][i]) * trail), fill=colour, width=max(1, round(sparks['size'][i] * unit)))
    draw.ellipse((cx - unit * 0.012, cy - unit * 0.012, cx + unit * 0.012, cy + unit * 0.012), fill=(255, 255, 225))
    return _glow(image, max(1, unit * 0.008), 1.1)


sparkler.cache = {}


def kolam(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    cx, cy = width * 0.5, height * 0.52
    step = unit * 0.105
    for gy in range(-2, 3):
        for gx in range(-2, 3):
            if abs(gx) + abs(gy) <= 3:
                r = max(1, unit * 0.004)
                draw.ellipse((cx + gx * step - r, cy + gy * step - r, cx + gx * step + r, cy + gy * step + r), fill=(160, 170, 175))
    rings = []
    for ring, samples in ((2.25, 96), (1.35, 72)):
        points = []
        for i in range(samples + 1):
            a = math.tau * i / samples
            wave = 0.18 * math.cos(4 * a)
            points.append((cx + step * (ring + wave) * math.cos(a), cy + step * (ring + wave) * math.sin(a)))
        rings.append(points)
    progress = min(1, (n / max(1, total - 1)) * 1.18)
    remaining = round(sum(map(len, rings)) * progress)
    for points in rings:
        shown = min(len(points), remaining)
        if shown >= 2:
            draw.line(points[:shown], fill=(245, 246, 238), width=max(1, round(unit * 0.008)), joint='curve')
        remaining -= shown
    return _glow(image, max(1, unit * 0.006), 0.75)


def balloons(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    items = balloons.cache.get(size)
    if items is None:
        items = balloons.cache[size] = {**_particles(rng, 18, x=(0.05, 0.95), phase=(0, 1.35), rise=(0.035, 0.075), size=(0.025, 0.065), sway=(0, 6.28), depth=(0.45, 1)),
                                             'colour': rng.integers(0, 6, 18)}
    colours = [(220, 55, 88), (244, 154, 45), (65, 155, 215), (147, 92, 205), (60, 174, 126), (232, 106, 161)]
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    order = np.argsort(items['depth'])
    for index in order:
        y = 1.16 - ((items['phase'][index] + t * items['rise'][index]) % 1.4)
        x = items['x'][index] + math.sin(t * 0.55 + items['sway'][index]) * 0.025
        depth = items['depth'][index]
        radius = items['size'][index] * unit * depth
        cx, cy = x * width, y * height
        colour = tuple(round(channel * (0.62 + depth * 0.35)) for channel in colours[items['colour'][index]])
        draw.ellipse((cx - radius * 0.82, cy - radius, cx + radius * 0.82, cy + radius), fill=colour)
        draw.ellipse((cx - radius * 0.42, cy - radius * 0.68, cx - radius * 0.18, cy - radius * 0.35), fill=tuple(min(255, c + 80) for c in colour))
        draw.polygon(((cx - radius * 0.12, cy + radius * 0.92), (cx + radius * 0.12, cy + radius * 0.92), (cx, cy + radius * 1.18)), fill=colour)
        draw.line((cx, cy + radius * 1.15, cx + math.sin(t + index) * radius * 0.18, cy + radius * 2.5), fill=(95, 95, 105), width=max(1, round(unit * 0.0015)))
    return image.filter(ImageFilter.GaussianBlur(max(0.15, unit * 0.0006)))


balloons.cache = {}


def glitter_burst(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    particles = glitter_burst.cache.get(size)
    if particles is None:
        particles = glitter_burst.cache[size] = _particles(rng, 190, angle=(0, 6.28), speed=(0.035, 0.24), delay=(0, 0.18), size=(0.001, 0.0045), turn=(0, 6.28))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    # Two short pops make the five-second clip useful at a title or between shots.
    age = min(((t - at) if t >= at else 99) for at in (0.72, 3.18))
    for i in range(len(particles['angle'])):
        local = age - particles['delay'][i]
        if not 0 <= local <= 1.25:
            continue
        fade = (1 - local / 1.25) ** 1.3
        travel = particles['speed'][i] * unit * (1 - math.exp(-local * 3.4)) * 4.4
        x = width * 0.5 + math.cos(particles['angle'][i]) * travel
        y = height * 0.5 + math.sin(particles['angle'][i]) * travel + unit * 0.07 * local * local
        radius = particles['size'][i] * unit * (0.6 + fade)
        colour = (round(255 * fade), round(214 * fade), round(92 * fade))
        if i % 4:
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=colour)
        else:
            draw.line((x - radius * 2, y, x + radius * 2, y), fill=colour, width=max(1, round(radius * 0.5)))
            draw.line((x, y - radius * 2, x, y + radius * 2), fill=colour, width=max(1, round(radius * 0.5)))
    return _glow(image, max(1, unit * 0.007), 1.0)


glitter_burst.cache = {}


def hearts(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    items = hearts.cache.get(size)
    if items is None:
        items = hearts.cache[size] = _particles(rng, 34, x=(0.02, 0.98), phase=(0, 1.25), rise=(0.035, 0.085), size=(0.008, 0.025), sway=(0, 6.28), light=(0.35, 0.85))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in range(len(items['x'])):
        y = 1.12 - ((items['phase'][i] + t * items['rise'][i]) % 1.3)
        x = items['x'][i] + math.sin(t * 0.65 + items['sway'][i]) * 0.025
        scale = items['size'][i] * unit
        points = []
        for sample in range(28):
            angle = math.tau * sample / 28
            hx = 16 * math.sin(angle) ** 3
            hy = 13 * math.cos(angle) - 5 * math.cos(2 * angle) - 2 * math.cos(3 * angle) - math.cos(4 * angle)
            points.append((x * width + hx * scale / 16, y * height - hy * scale / 16))
        light = items['light'][i]
        draw.polygon(points, fill=(round(245 * light), round(92 * light), round(135 * light)))
    return _glow(image, max(0.6, unit * 0.0025), 0.45)


hearts.cache = {}


def sun_rays(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    t = n / FPS
    image = Image.new('RGB', size)
    beams = Image.new('RGB', size)
    draw = ImageDraw.Draw(beams)
    origin = (-unit * 0.08, -unit * 0.05)
    breathe = 0.72 + 0.18 * math.sin(t * 0.45)
    for i, (angle, spread, strength) in enumerate((
        (0.38, 0.085, 0.20), (0.54, 0.055, 0.14), (0.70, 0.11, 0.11), (0.88, 0.07, 0.09))):
        drift = 0.025 * math.sin(t * 0.32 + i * 1.7)
        reach = math.hypot(width, height) * 1.25
        a0, a1 = angle + drift - spread, angle + drift + spread
        colour = tuple(round(c * strength * breathe) for c in (255, 224, 168))
        draw.polygon((origin, (origin[0] + math.cos(a0) * reach, origin[1] + math.sin(a0) * reach),
                      (origin[0] + math.cos(a1) * reach, origin[1] + math.sin(a1) * reach)), fill=colour)
    beams = beams.filter(ImageFilter.GaussianBlur(max(4, unit * 0.045)))
    haze = _field(size, [(-0.03, -0.03, 0.38, (255, 226, 175), 0.34 * breathe)])
    return Image.fromarray(np.clip(np.asarray(beams, np.int16) + np.asarray(haze, np.int16), 0, 255).astype(np.uint8))


def prism_leak(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    t = n / max(1, total - 1)
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    centre = (-0.18 + t * 1.36) * width
    slope = height * 0.18
    colours = ((220, 45, 75), (245, 145, 35), (225, 220, 65), (70, 190, 125), (65, 135, 225), (155, 75, 205))
    band = max(2, unit * 0.012)
    for index, colour in enumerate(colours):
        offset = (index - 2.5) * band
        points = ((centre + offset - band, -height * 0.1), (centre + offset + band, -height * 0.1),
                  (centre + slope + offset + band, height * 1.1), (centre + slope + offset - band, height * 1.1))
        draw.polygon(points, fill=tuple(round(c * 0.34) for c in colour))
    return image.filter(ImageFilter.GaussianBlur(max(1, unit * 0.01)))


def anamorphic(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    t = n / FPS
    # Work smaller: all parts are optical bloom, so smooth upscaling improves the result and keeps generation quick.
    small_w, small_h = max(80, width // 4), max(45, height // 4)
    ys, xs = np.mgrid[0:small_h, 0:small_w].astype(np.float32)
    xs /= small_w; ys /= small_h
    picture = np.zeros((small_h, small_w, 3), np.float32)
    # One hero sweep and two dim, offset reflections. Their brightness breathes independently.
    lights = (
        (0.12 + (t / SECONDS) * 0.78, 0.43 + 0.035 * math.sin(t * 0.7), 0.72 + 0.18 * math.sin(t * 1.1)),
        (0.70 - (t / SECONDS) * 0.24, 0.67, 0.28 + 0.07 * math.sin(t * 0.63 + 1.4)),
        (0.35 + 0.06 * math.sin(t * 0.31), 0.27, 0.16 + 0.05 * math.sin(t * 0.82 + 2.1)),
    )
    for index, (cx, cy, strength) in enumerate(lights):
        strength = max(0.05, strength)
        horizontal = np.exp(-np.abs(xs - cx) / (0.24 + index * 0.05))
        broad = np.exp(-((ys - cy) / (0.014 + index * 0.004)) ** 2) * horizontal * strength
        fine = np.exp(-((ys - cy) / 0.0028) ** 2) * np.exp(-np.abs(xs - cx) / 0.38) * strength
        core = np.exp(-(((xs - cx) / 0.026) ** 2 + ((ys - cy) / 0.038) ** 2)) * strength
        # Blue centre, cyan upper fringe and faint violet lower fringe mimic coated cinema glass.
        picture += broad[..., None] * np.array((28, 74, 175), np.float32)
        picture += fine[..., None] * np.array((95, 170, 255), np.float32)
        picture += core[..., None] * np.array((225, 238, 255), np.float32)
        picture += (np.exp(-((ys - cy + 0.006) / 0.0035) ** 2) * horizontal * strength)[..., None] * np.array((10, 64, 105), np.float32)
        picture += (np.exp(-((ys - cy - 0.007) / 0.0045) ** 2) * horizontal * strength)[..., None] * np.array((48, 12, 85), np.float32)
    image = Image.fromarray(np.clip(picture, 0, 255).astype(np.uint8)).resize(size, Image.BICUBIC)
    ghosts = Image.new('RGB', size)
    draw = ImageDraw.Draw(ghosts)
    hero_x, hero_y = lights[0][0] * width, lights[0][1] * height
    for share, radius, colour in ((0.32, 0.018, (12, 45, 105)), (0.55, 0.028, (18, 62, 120)), (0.78, 0.012, (54, 24, 85))):
        gx = width * 0.5 + (width * 0.5 - hero_x) * share * 1.45
        gy = height * 0.5 + (height * 0.5 - hero_y) * share * 0.42
        r = unit * radius
        draw.ellipse((gx - r, gy - r, gx + r, gy + r), outline=colour, width=max(1, round(unit * 0.002)))
    # Tiny aperture glints near the hero source break the computer-perfect line.
    for offset, brightness in ((-0.045, 0.32), (0.036, 0.25), (0.082, 0.16)):
        gx = hero_x + offset * width
        r = unit * 0.004
        colour = tuple(round(c * brightness) for c in (190, 225, 255))
        draw.line((gx - r * 5, hero_y, gx + r * 5, hero_y), fill=colour, width=max(1, round(r * 0.45)))
        draw.line((gx, hero_y - r, gx, hero_y + r), fill=colour, width=max(1, round(r * 0.35)))
    return Image.fromarray(np.clip(np.asarray(image, np.int16) + np.asarray(_glow(ghosts, max(1, unit * 0.01), 0.8), np.int16), 0, 255).astype(np.uint8))


def light_flicker(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    t = n / FPS
    # Several incommensurate waves avoid a mechanical on/off pulse. Screen blend only lifts exposure.
    amount = 0.19 + 0.07 * math.sin(t * 7.1) + 0.045 * math.sin(t * 13.7 + 1.3) + 0.025 * math.sin(t * 23.9 + 0.4)
    amount = max(0.065, min(0.32, amount))
    warm = (round(255 * amount), round(238 * amount), round(210 * amount))
    return Image.new('RGB', size, warm)


def fireflies(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    bugs = fireflies.cache.get(size)
    if bugs is None:
        bugs = fireflies.cache[size] = _particles(rng, 42, x=(0.03, 0.97), y=(0.12, 0.92), phase=(0, 6.28), rate=(0.7, 1.8), drift=(0, 6.28), size=(0.002, 0.006), green=(0.55, 0.9))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in range(len(bugs['x'])):
        glow = max(0, math.sin(t * bugs['rate'][i] + bugs['phase'][i])) ** 4
        if glow < 0.025:
            continue
        x = bugs['x'][i] + 0.018 * math.sin(t * 0.4 + bugs['drift'][i])
        y = bugs['y'][i] + 0.012 * math.sin(t * 0.31 + bugs['drift'][i] * 1.7)
        radius = bugs['size'][i] * unit * (0.55 + glow)
        colour = (round(235 * glow), round((170 + 70 * bugs['green'][i]) * glow), round(72 * glow))
        draw.ellipse((x * width - radius, y * height - radius, x * width + radius, y * height + radius), fill=colour)
    return _glow(image, max(1, unit * 0.009), 1.6)


fireflies.cache = {}


def lanterns(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    items = lanterns.cache.get(size)
    if items is None:
        items = lanterns.cache[size] = _particles(rng, 19, x=(0.04, 0.96), phase=(0, 1.4), rise=(0.025, 0.07), size=(0.012, 0.04), sway=(0, 6.28), depth=(0.45, 1))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in np.argsort(items['depth']):
        y = 1.18 - ((items['phase'][i] + t * items['rise'][i]) % 1.42)
        x = items['x'][i] + math.sin(t * 0.38 + items['sway'][i]) * 0.018
        depth = items['depth'][i]
        half_w = items['size'][i] * unit * depth
        half_h = half_w * 1.28
        cx, cy = x * width, y * height
        shell = (round(205 * depth), round(92 * depth), round(28 * depth))
        draw.rounded_rectangle((cx - half_w, cy - half_h, cx + half_w, cy + half_h), radius=max(1, half_w * 0.38), fill=shell)
        core = half_w * 0.42
        draw.ellipse((cx - core, cy - core * 0.7, cx + core, cy + core * 0.7), fill=(round(255 * depth), round(218 * depth), round(105 * depth)))
        draw.line((cx - half_w * 0.7, cy + half_h, cx + half_w * 0.7, cy + half_h), fill=(115, 55, 22), width=max(1, round(unit * 0.002)))
    return _glow(image, max(1, unit * 0.012), 1.1)


lanterns.cache = {}


def leaves(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    items = leaves.cache.get(size)
    if items is None:
        items = leaves.cache[size] = {**_particles(rng, 58, x=(-0.05, 1.05), phase=(0, 1.18), fall=(0.06, 0.15), size=(0.008, 0.022), sway=(0, 6.28), spin=(-2.2, 2.2), depth=(0.45, 1)),
                                          'colour': rng.integers(0, 5, 58)}
    colours = ((190, 62, 28), (224, 113, 24), (235, 163, 35), (125, 104, 35), (152, 45, 31))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in np.argsort(items['depth']):
        y = ((items['phase'][i] + t * items['fall'][i]) % 1.22) - 0.1
        x = items['x'][i] + 0.045 * math.sin(t * 0.8 + items['sway'][i])
        depth = items['depth'][i]
        radius = items['size'][i] * unit * depth
        angle = items['sway'][i] + t * items['spin'][i]
        squash = 0.28 + 0.72 * abs(math.cos(angle * 0.8))
        cx, cy = x * width, y * height
        c, s = math.cos(angle), math.sin(angle)
        raw = ((0, -radius), (radius * 0.65 * squash, 0), (0, radius), (-radius * 0.65 * squash, 0))
        points = [(cx + px * c - py * s, cy + px * s + py * c) for px, py in raw]
        colour = tuple(round(channel * (0.62 + depth * 0.38)) for channel in colours[items['colour'][i]])
        draw.polygon(points, fill=colour)
        draw.line((points[0][0], points[0][1], points[2][0], points[2][1]), fill=tuple(round(c * 0.55) for c in colour), width=1)
    return image


leaves.cache = {}


def caustics(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    small = (max(48, width // 8), max(32, height // 8))
    ys, xs = np.mgrid[0:small[1], 0:small[0]].astype(np.float32)
    xs /= small[0]; ys /= small[1]
    t = n / FPS
    a = np.sin(xs * 24 + ys * 9 + t * 1.15)
    b = np.sin(xs * 15 - ys * 19 - t * 0.86)
    c = np.sin(xs * 31 + ys * 25 + t * 0.54)
    # Thin interference ridges resemble refracted sunlight rather than soft bokeh blobs.
    ridges = np.clip(np.exp(-np.abs(a + b) * 9) * 0.22 + np.exp(-np.abs(b + c) * 11) * 0.18, 0, 0.3)
    colour = np.array([96, 202, 238], np.float32)
    picture = np.clip(ridges[..., None] * colour, 0, 255).astype(np.uint8)
    return Image.fromarray(picture).resize(size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(max(1, min(size) * 0.006)))


def sea_sparkle(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    width, height = size
    unit = min(size)
    points = sea_sparkle.cache.get(size)
    if points is None:
        points = sea_sparkle.cache[size] = _particles(rng, 125, x=(0.08, 0.92), y=(0.42, 0.94), phase=(0, 6.28), rate=(1.2, 4.2), size=(0.002, 0.009), stretch=(1.5, 6))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    t = n / FPS
    for i in range(len(points['x'])):
        flash = max(0, math.sin(t * points['rate'][i] + points['phase'][i])) ** 7
        if flash < 0.03:
            continue
        y = points['y'][i]
        # Perspective: glints near the horizon are smaller and closer together.
        perspective = 0.25 + (y - 0.42) / 0.52 * 0.75
        half = points['size'][i] * unit * points['stretch'][i] * perspective * flash
        x = points['x'][i] * width
        colour = tuple(round(c * flash) for c in (255, 240, 188))
        draw.line((x - half, y * height, x + half, y * height), fill=colour, width=max(1, round(unit * 0.002 * perspective)))
    return _glow(image, max(0.7, unit * 0.003), 0.65)


sea_sparkle.cache = {}


# An ember cools as it climbs: white-yellow at the fire, through orange, to a dull red just before it dies.
EmberHeat = [(0.0, (255, 236, 170)), (0.25, (255, 168, 60)), (0.6, (235, 92, 24)), (1.0, (150, 32, 10))]


def _ember_colour(age: float) -> tuple[float, float, float]:
    for (a0, c0), (a1, c1) in zip(EmberHeat, EmberHeat[1:]):
        if age <= a1:
            k = (age - a0) / (a1 - a0)
            return tuple(x + (y - x) * k for x, y in zip(c0, c1))
    return EmberHeat[-1][1]


def embers(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """Sparks rising from a fire below: quick, swaying in the heat, cooling and flickering out, near ones larger and soft."""
    width, height = size
    unit = min(size)
    t = n / FPS
    sparks = embers.cache.get(size)
    if sparks is None:
        sparks = embers.cache[size] = _particles(rng, 95, x=(0.05, 0.95), phase=(0, 1), life=(1.6, 3.4), rise=(0.32, 0.6), drift=(-0.06, 0.06),
                                                 sway=(0, 6.28), wobble=(1.2, 3.4), size=(0.0012, 0.0042), depth=(0, 1), flicker=(7, 16))
    far, near = Image.new('RGB', size), Image.new('RGB', size)
    far_draw, near_draw = ImageDraw.Draw(far), ImageDraw.Draw(near)
    for i in range(len(sparks['x'])):
        life = sparks['life'][i]
        # Each spark lives part of a loop and is born again at the fire, so the effect starts already burning.
        age = ((t / life + sparks['phase'][i]) % 1.0)
        depth = sparks['depth'][i]
        lift = sparks['rise'][i] * (0.6 + 0.6 * depth)

        def where(a: float) -> tuple[float, float]:
            climbed = lift * life * a * (1 - 0.25 * a)  # Quick off the fire, slowing as it cools.
            # Hot air swirls: two slow waves and a quicker flutter, growing as the spark rises, so no two paths are straight.
            s = a * life
            heat = (math.sin(s * sparks['wobble'][i] + sparks['sway'][i]) * 0.045 + math.sin(s * sparks['wobble'][i] * 2.7 + sparks['sway'][i] * 3) * 0.018) * (0.3 + a)
            return (sparks['x'][i] + sparks['drift'][i] * a * 2 + heat) * width, (1.04 - climbed) * height

        x, y = where(age)
        if y < -0.05 * height:
            continue
        glow = (1 - age) ** 1.3 * min(1.0, age / 0.06)  # Bright at birth, fading out; never pops on.
        glow *= 0.72 + 0.28 * math.sin(t * sparks['flicker'][i] + sparks['sway'][i] * 5)
        glow *= 0.55 + 0.45 * depth
        if glow < 0.03:
            continue
        colour = tuple(int(c * glow) for c in _ember_colour(age))
        r = max(0.6, sparks['size'][i] * unit * (0.5 + 1.1 * depth) * (1.15 - 0.4 * age))
        draw = near_draw if depth > 0.7 else far_draw
        tx, ty = where(max(0.0, age - 0.012 / life))  # A short streak, as a camera sees a fast spark.
        draw.line((tx, ty, x, y), fill=tuple(int(c * 0.6) for c in colour), width=max(1, round(r * 1.5)))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=colour)
    far = far.filter(ImageFilter.GaussianBlur(max(0.5, unit * 0.0012)))
    near = near.filter(ImageFilter.GaussianBlur(max(0.9, unit * 0.003)))  # Close to the lens, so a little out of focus.
    picture = np.asarray(far, np.float32) + np.asarray(near, np.float32)
    # The fire itself sits below the frame; only its warm light reaches the bottom edge, breathing with the flames.
    breathe = 0.2 + 0.05 * math.sin(t * 3.3) + 0.03 * math.sin(t * 7.9)
    picture += np.asarray(_field(size, [(0.5, 1.12, 0.38, (255, 110, 30), breathe), (0.3, 1.1, 0.2, (255, 150, 60), breathe * 0.6)]), np.float32)
    return _glow(Image.fromarray(np.clip(picture, 0, 255).astype(np.uint8)), max(1.0, unit * 0.006), 0.9)


embers.cache = {}


def _ease(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def night_sky(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """Stars at three depths, each twinkling at its own pace, and now and then a shooting star with a fading tail."""
    width, height = size
    unit = min(size)
    t = n / FPS
    sky = night_sky.cache.get(size)
    if sky is None:
        stars = _particles(rng, 230, x=(0, 1), y=(0, 1), depth=(0, 1), phase=(0, 6.28), rate=(0.6, 2.4), warmth=(0, 1))
        meteors = [{'at': at, 'x': rng.uniform(0.15, 0.75), 'y': rng.uniform(0.05, 0.35), 'angle': rng.uniform(0.35, 0.65), 'length': rng.uniform(0.28, 0.42)}
                   for at in (0.7, 2.3, 3.8)]
        sky = night_sky.cache[size] = (stars, meteors)
    stars, meteors = sky
    far, near = Image.new('RGB', size), Image.new('RGB', size)
    far_draw, near_draw = ImageDraw.Draw(far), ImageDraw.Draw(near)
    for i in range(len(stars['x'])):
        depth = stars['depth'][i]
        twinkle = 0.55 + 0.45 * math.sin(t * stars['rate'][i] + stars['phase'][i]) ** 2
        light = (0.25 + 0.75 * depth ** 2) * twinkle
        w = stars['warmth'][i]
        colour = tuple(int(c * light) for c in (215 + 40 * w, 225 + 20 * w, 255 - 45 * w))  # Blue-white to warm, like real stars.
        r = max(0.5, unit * (0.0008 + 0.0022 * depth ** 2))
        x, y = stars['x'][i] * width, stars['y'][i] * height
        (near_draw if depth > 0.8 else far_draw).ellipse((x - r, y - r, x + r, y + r), fill=colour)
    for meteor in meteors:
        age = (t - meteor['at']) / 0.75  # Across the sky in three quarters of a second.
        if not 0 <= age <= 1:
            continue
        travel = _ease(age)
        dx, dy = math.cos(meteor['angle']), math.sin(meteor['angle'])
        hx, hy = (meteor['x'] + dx * meteor['length'] * travel) * width, (meteor['y'] + dy * meteor['length'] * travel) * height
        tail = unit * 0.16 * math.sin(math.pi * age)  # Grows, then shrinks as it burns out.
        fade = math.sin(math.pi * age)
        for k in range(10):  # The tail fades towards its end.
            a, b = k / 10, (k + 1) / 10
            shade = int(255 * fade * (1 - a) ** 1.6)
            near_draw.line((hx - dx * tail * a, hy - dy * tail * a, hx - dx * tail * b, hy - dy * tail * b), fill=(shade, shade, min(255, shade + 10)), width=max(1, round(unit * 0.0025 * (1 - a))))
        r = unit * 0.003 * fade
        near_draw.ellipse((hx - r, hy - r, hx + r, hy + r), fill=(255, 250, 235))
    far = far.filter(ImageFilter.GaussianBlur(max(0.4, unit * 0.0008)))
    picture = Image.fromarray(np.clip(np.asarray(far, np.int16) + np.asarray(near, np.int16), 0, 255).astype(np.uint8))
    return _glow(picture, max(1, unit * 0.004), 0.9)


night_sky.cache = {}


def bubbles(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """Soap bubbles rising and wobbling: a thin rim with a rainbow sheen and a window highlight. Some pop in a sparkle."""
    width, height = size
    unit = min(size)
    t = n / FPS
    p = bubbles.cache.get(size)
    if p is None:
        p = bubbles.cache[size] = _particles(rng, 26, x=(0.05, 0.95), phase=(0, 1), rise=(0.06, 0.13), size=(0.025, 0.07), sway=(0, 6.28), wobble=(0.8, 1.8), sheen=(0, 6.28), pop=(0.55, 1.6))
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    for i in range(len(p['x'])):
        # Rises from below the frame; a bubble that reaches its `pop` height bursts (pop over 1 means it floats away).
        travel = (p['phase'][i] + t * p['rise'][i]) % 1.3
        r = p['size'][i] * unit
        x = (p['x'][i] + 0.03 * math.sin(t * p['wobble'][i] + p['sway'][i])) * width
        y = (1.1 - travel) * height
        popped = travel - p['pop'][i]
        if 0 <= popped < 0.04:
            burst = popped / 0.04
            for k in range(8):
                angle = k * math.pi / 4 + p['sheen'][i]
                a, b = r * (0.6 + burst), r * (0.9 + 1.2 * burst)
                shade = int(230 * (1 - burst))
                draw.line((x + math.cos(angle) * a, y + math.sin(angle) * a, x + math.cos(angle) * b, y + math.sin(angle) * b), fill=(shade, shade, shade), width=max(1, round(unit * 0.002)))
            continue
        if popped >= 0:
            continue
        squash = 1 + 0.04 * math.sin(t * 5 + p['sway'][i])  # A soft wobble in shape.
        box = (x - r * squash, y - r / squash, x + r * squash, y + r / squash)
        # The rim's colour moves round the bubble, like oil on water.
        for k in range(12):
            start = k * 30
            hue = (k / 12 + p['sheen'][i] / 6.28 + t * 0.15) % 1
            rgb = tuple(int(90 + 110 * (0.5 + 0.5 * math.cos(6.28 * (hue + shift)))) for shift in (0, 0.33, 0.66))
            draw.arc(box, start, start + 32, fill=rgb, width=max(1, round(r * 0.06)))
        draw.ellipse((x - r * 0.95, y - r * 0.95, x + r * 0.95, y + r * 0.95), fill=(14, 16, 20))  # The faint film inside.
        hx, hy, hr = x - r * 0.42, y - r * 0.45, r * 0.2
        draw.ellipse((hx - hr, hy - hr * 0.7, hx + hr, hy + hr * 0.7), fill=(235, 240, 245))  # The window highlight.
    return _glow(image.filter(ImageFilter.GaussianBlur(max(0.6, unit * 0.0015))), max(1, unit * 0.005), 0.6)


bubbles.cache = {}


RangoliColours = [(236, 64, 122), (255, 152, 0), (255, 214, 0), (102, 187, 106), (240, 240, 230), (156, 39, 176)]


def rangoli_border(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """Flowers and dots drawn in round the edge of the frame, one after another, then glowing gently."""
    width, height = size
    unit = min(size)
    t = n / FPS
    step = unit * 0.075
    margin = unit * 0.045
    # Places round the edge, clockwise from the top left, so the border draws itself like a hand going round.
    places = rangoli_border.cache.get(size)
    if places is None:
        places = []
        across, down = max(2, round((width - 2 * margin) / step)), max(2, round((height - 2 * margin) / step))
        places += [(margin + (width - 2 * margin) * k / across, margin) for k in range(across)]
        places += [(width - margin, margin + (height - 2 * margin) * k / down) for k in range(down)]
        places += [(width - margin - (width - 2 * margin) * k / across, height - margin) for k in range(across)]
        places += [(margin, height - margin - (height - 2 * margin) * k / down) for k in range(down)]
        rangoli_border.cache[size] = places
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    reveal = 2.2  # Seconds to go all the way round.
    glow = 0.85 + 0.15 * math.sin(t * 2.2)
    for k, (x, y) in enumerate(places):
        grow = _ease((t - reveal * k / len(places)) / 0.35)
        if grow <= 0:
            continue
        light = grow * glow
        if k % 2 == 0:  # A flower: petals round a centre.
            petal, colour = step * 0.28 * grow, RangoliColours[(k // 2) % len(RangoliColours)]
            for j in range(8):
                angle = j * math.pi / 4 + k
                px, py = x + math.cos(angle) * petal * 0.9, y + math.sin(angle) * petal * 0.9
                draw.ellipse((px - petal * 0.42, py - petal * 0.42, px + petal * 0.42, py + petal * 0.42), fill=tuple(int(c * light) for c in colour))
            core = petal * 0.38
            draw.ellipse((x - core, y - core, x + core, y + core), fill=tuple(int(c * light) for c in (255, 230, 120)))
        else:  # Between flowers, three white dots as in a dot kolam.
            for offset in (-0.22, 0, 0.22):
                along = (step * offset, 0) if y in (margin, height - margin) else (0, step * offset)
                d = step * 0.06 * grow
                cx, cy = x + along[0], y + along[1]
                draw.ellipse((cx - d, cy - d, cx + d, cy + d), fill=tuple(int(240 * light) for _ in range(3)))
    return _glow(image, max(1, unit * 0.006), 0.7)


rangoli_border.cache = {}


def _stroke(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], share: float, width: int, colour: tuple[int, int, int]) -> None:
    """Draws the first `share` of a path, as a hand would: the line grows from its start."""
    count = max(2, round(len(points) * max(0.0, min(1.0, share))))
    if count >= 2 and share > 0:
        draw.line(points[:count], fill=colour, width=width, joint='curve')
        for x, y in (points[0], points[count - 1]):  # Round ends, like a marker.
            draw.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2), fill=colour)


CalloutYellow = (255, 214, 10)


def callout_circle(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """A marker circle drawn by hand in the middle of the frame. Move and size it over what you want to point at."""
    width, height = size
    unit = min(size)
    t = n / FPS
    cx, cy, r = width / 2, height / 2, unit * 0.22
    # A little more than a full turn, slightly uneven, as a hand draws it.
    points = [(cx + r * (1 + 0.04 * math.sin(a * 3 + 1)) * math.cos(a) * 1.15, cy + r * (1 + 0.05 * math.sin(a * 2)) * math.sin(a))
              for a in np.linspace(-2.2, -2.2 + 2 * math.pi * 1.06, 90)]
    image = Image.new('RGB', size)
    _stroke(ImageDraw.Draw(image), points, _ease((t - 0.15) / 0.55), max(2, round(unit * 0.012)), CalloutYellow)
    return _glow(image, max(1, unit * 0.004), 0.5)


def callout_arrow(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """A marker arrow swooping in from the lower left to point at the middle of the frame."""
    width, height = size
    unit = min(size)
    t = n / FPS
    tip = (width / 2, height / 2)
    start = (tip[0] - unit * 0.32, tip[1] + unit * 0.3)
    bend = (tip[0] - unit * 0.3, tip[1] + unit * 0.02)
    points = [((1 - s) ** 2 * start[0] + 2 * (1 - s) * s * bend[0] + s * s * tip[0], (1 - s) ** 2 * start[1] + 2 * (1 - s) * s * bend[1] + s * s * tip[1]) for s in np.linspace(0, 0.94, 60)]
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    stroke = max(2, round(unit * 0.012))
    _stroke(draw, points, _ease((t - 0.15) / 0.45), stroke, CalloutYellow)
    head = _ease((t - 0.55) / 0.2)
    if head > 0:
        angle = math.atan2(tip[1] - points[-6][1], tip[0] - points[-6][0])
        reach = unit * 0.07 * head
        for side in (2.55, -2.55):
            _stroke(draw, [tip, (tip[0] + math.cos(angle + side) * reach, tip[1] + math.sin(angle + side) * reach)], 1, stroke, CalloutYellow)
    return _glow(image, max(1, unit * 0.004), 0.5)


def speed_lines(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """Comic-book streaks rushing in from the edges towards a clear middle, redrawn every other frame so they flicker."""
    width, height = size
    unit = min(size)
    beat = n // 2
    lines = np.random.default_rng(9173 + beat)  # Same lines for both frames of a pair, so the flicker is even.
    image = Image.new('RGB', size)
    draw = ImageDraw.Draw(image)
    cx, cy = width / 2, height / 2
    far = math.hypot(width, height) / 2
    for _ in range(70):
        angle = lines.uniform(0, 2 * math.pi)
        inner = far * lines.uniform(0.42, 0.7)  # The clear middle varies a little, like hand-drawn lines.
        spread = lines.uniform(0.004, 0.012)
        shade = int(lines.uniform(150, 245))
        tip = (cx + math.cos(angle) * inner, cy + math.sin(angle) * inner)
        edge = far * 1.05
        a, b = angle - spread, angle + spread
        # A thin wedge: wide at the frame's edge, coming to a point towards the middle.
        draw.polygon([tip, (cx + math.cos(a) * edge, cy + math.sin(a) * edge), (cx + math.cos(b) * edge, cy + math.sin(b) * edge)], fill=(shade, shade, shade))
    return image.filter(ImageFilter.GaussianBlur(max(0.5, unit * 0.0012)))


COUNT_FROM = 5  # The leader counts COUNT_FROM down to 2, a second each, then holds black for the last second.
BEEP_AT = COUNT_FROM - 2  # The classic "2-pop": one frame of 1 kHz tone as the 2 appears.
FONTS = Path(__file__).resolve().parent.parent / 'assets' / 'fonts'


def countdown(n: int, total: int, size: tuple[int, int], rng: np.random.Generator) -> Image.Image:
    """An Academy-style film leader: grey, two rings, a cross, a hand sweeping round once a second and the number."""
    width, height = size
    unit = min(size)
    t = n / FPS
    second = int(t)
    if second > BEEP_AT:
        return Image.new('RGB', size)
    within = t - second
    font = countdown.cache.get(unit)
    if font is None:
        from PIL import ImageFont
        font = countdown.cache[unit] = ImageFont.truetype(str(FONTS / 'NotoSans-Bold.ttf'), round(unit * 0.36))
    image = Image.new('RGB', size, (148, 148, 148))
    draw = ImageDraw.Draw(image)
    cx, cy = width / 2, height / 2
    outer, inner = unit * 0.40, unit * 0.32
    # The sweep: the part of the circle the hand has passed is lighter, as on real leader.
    draw.pieslice((cx - outer * 2, cy - outer * 2, cx + outer * 2, cy + outer * 2), -90, -90 + 360 * within, fill=(186, 186, 186))
    line = max(2, round(unit * 0.008))
    draw.line((0, cy, width, cy), fill=(40, 40, 40), width=line)
    draw.line((cx, 0, cx, height), fill=(40, 40, 40), width=line)
    for radius in (outer, inner):
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=(245, 245, 245), width=max(2, round(unit * 0.012)))
    number = str(COUNT_FROM - second)
    draw.text((cx, cy), number, font=font, fill=(25, 25, 25), anchor='mm')
    # Old prints flicker and carry a little dust.
    flicker = 1 + 0.04 * math.sin(n * 2.7) * math.sin(n * 0.9)
    picture = np.asarray(image, np.float32) * flicker
    speck = np.random.default_rng(n)
    for _ in range(3):
        x, y, r = speck.integers(0, width), speck.integers(0, height), speck.uniform(1, max(1.5, unit * 0.004))
        picture[max(0, int(y - r)):int(y + r) + 1, max(0, int(x - r)):int(x + r) + 1] *= 0.35
    return Image.fromarray(np.clip(picture, 0, 255).astype(np.uint8))


countdown.cache = {}


def effect_audio(effect_id: str) -> list[str]:
    """ffmpeg inputs for an effect's own sound: the leader's beep. Other effects are silent."""
    if effect_id != 'countdown':
        return []
    start, end = BEEP_AT, BEEP_AT + 1 / 24
    return ['-f', 'lavfi', '-i', f"aevalsrc='if(between(t,{start},{end:.4f}),0.5*sin(2*PI*1000*t),0)':s=48000:d={SECONDS}"]


EFFECT_PAINTERS: dict[str, Painter] = {
    'confetti': falling(ConfettiColours, 110, (0.011, 0.022), 0.03, 3.0, 'rect'),
    'petals': falling([(255, 153, 0), (255, 196, 0), (230, 40, 70), (255, 110, 150)], 80, (0.017, 0.03), 0.05, 1.2, 'petal'),
    'jasmine': jasmine,
    'akshatai': akshatai,
    'thoranam': thoranam,
    'diya': diya,
    'incense-smoke': incense_smoke,
    'embers': embers,
    'night-sky': night_sky,
    'bubbles': bubbles,
    'rangoli-border': rangoli_border,
    'callout-circle': callout_circle,
    'callout-arrow': callout_arrow,
    'speed-lines': speed_lines,
    'countdown': countdown,
    'sparkler': sparkler,
    'kolam': kolam,
    'balloons': balloons,
    'glitter-burst': glitter_burst,
    'hearts': hearts,
    'sun-rays': sun_rays,
    'prism-leak': prism_leak,
    'anamorphic': anamorphic,
    'light-flicker': light_flicker,
    'fireflies': fireflies,
    'lanterns': lanterns,
    'leaves': leaves,
    'caustics': caustics,
    'sea-sparkle': sea_sparkle,
    'snow': snow,
    'rain': rain,
    'lightning': lightning,
    'fog': fog,
    'dust': dust,
    'lens-flare': lens_flare,
    'sparkles': sparkles,
    'shine': shine,
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
    audio = effect_audio(effect_id)
    sound = ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-shortest'] if audio else []
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{size[0]}x{size[1]}', '-r', str(FPS), '-i', '-', *audio,
                                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', *sound, '-movflags', '+faststart', str(partial)], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
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
