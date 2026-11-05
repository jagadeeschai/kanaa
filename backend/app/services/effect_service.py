"""Special effects for celebrations and travel: confetti, a flower shower, sparkles, fireworks and more.

Each effect is drawn once, here, on black, as a short video in the shape of the project. The editor lays it over the
video on its own layer with the Screen blend, which drops the black and keeps the light. Preview and export already
draw overlays and Screen the same way, so an effect looks the same in both without any new shader or filter code.
Everything is made from code on this Mac: nothing is downloaded.
"""
from __future__ import annotations

import math
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

VERSION = 1  # Bump when an effect's drawing changes, so new copies are made.
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
    Effect('snow', 'Snow', 'பனி', 'travel', 'Gentle snow, for hills and winter trips'),
]
BY_ID = {effect.id: effect for effect in EFFECTS}


def work_size(width: int, height: int) -> tuple[int, int]:
    scale = SHORT_SIDE / min(width, height)
    return max(2, round(width * scale / 2) * 2), max(2, round(height * scale / 2) * 2)


def effect_path(effect_id: str, size: tuple[int, int]) -> Path:
    return settings.data_dir / 'effects' / f'{effect_id}-{size[0]}x{size[1]}-v{VERSION}.mp4'


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


EFFECT_PAINTERS: dict[str, Painter] = {
    'confetti': falling(ConfettiColours, 110, (0.011, 0.022), 0.03, 3.0, 'rect'),
    'petals': falling([(255, 153, 0), (255, 196, 0), (230, 40, 70), (255, 110, 150)], 80, (0.017, 0.03), 0.05, 1.2, 'petal'),
    'snow': falling([(235, 240, 255), (200, 210, 230)], 160, (0.002, 0.006), 0.02, 0.5, 'petal'),
    'sparkles': sparkles,
    'fireworks': fireworks,
    'bokeh': bokeh,
    'light-leak': light_leak,
    'film-burn': film_burn,
}


def render_effect(effect_id: str, size: tuple[int, int], target: Path, on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> Path:
    paint = EFFECT_PAINTERS[effect_id]
    rng = np.random.default_rng(sum(map(ord, effect_id)))  # The same effect looks the same every time it is made.
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
            process.stdin.write(paint(n, total, size, rng).convert('RGB').tobytes())
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
