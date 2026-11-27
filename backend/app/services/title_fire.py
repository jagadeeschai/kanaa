"""A title on fire: flames rising from the letters' own edges, the letters glowing hot from inside, a warm halo, and
embers drifting up off them. Made from the title as Kanaa draws it (title_design.letters, the same libass path as
the export), as a 4 s video that loops seamlessly, light on black, for a Screen-blend layer under the words: the
preview and the export play the same clip, so they cannot differ.

Every frame depends only on the letters, the strength and the frame number (the noise is seeded and scrolls a whole
period per loop), so a title always burns the same way and a remade clip is identical.
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np

from app.core.config import settings
from app.services.timeline_schema import Format, Text

VERSION = 2  # 2: flames from the tops of the letters, sized to one line.
LOOP = 4.0  # Seconds; the clip repeats under a longer title.
FPS = 30
STRENGTHS = {'glow': 0.55, 'blaze': 0.85, 'inferno': 1.15}  # How tall and bright the flames are.
EMBERS = 46


def target_path(item: Text, fmt: Format, strength: str) -> Path:
    ident = json.dumps([VERSION, item.model_dump(mode='json', exclude={'id', 'start', 'length', 'enter', 'exit'}), fmt.model_dump(mode='json'), strength], sort_keys=True)
    return settings.data_dir / 'media' / f'title-fire-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def _periodic_noise(height: int, width: int, seed: int, scale: float) -> np.ndarray:
    """Smooth noise that wraps top to bottom (so scrolling it a whole height loops), 0..1."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((height, width))
    fy = np.fft.fftfreq(height)[:, None]; fx = np.fft.rfftfreq(width)[None, :]
    smooth = np.fft.irfft2(np.fft.rfft2(white) * np.exp(-(fx ** 2 + fy ** 2) * (scale ** 2)), s=(height, width))
    smooth -= smooth.min()
    return (smooth / max(1e-6, smooth.max())).astype(np.float32)


def _blur(field: np.ndarray, radius: float) -> np.ndarray:
    import cv2
    return cv2.GaussianBlur(field, (0, 0), radius) if radius > 0 else field


def _colour(heat: np.ndarray) -> np.ndarray:
    """Black body: dark red at a flame's edge, orange, then yellow-white at its hottest."""
    return np.stack([np.clip(heat * 2.1, 0, 1), np.clip(heat * 1.7 - 0.45, 0, 1), np.clip(heat * 2.4 - 1.75, 0, 1)], -1)


class Burner:
    """Works out what stays the same in every frame once (the letters, the noise, the embers), then draws frame n."""

    def __init__(self, alpha: np.ndarray, strength: float, seed: int = 7):
        import cv2
        self.full = alpha.shape
        self.h, self.w = alpha.shape[0] // 2, alpha.shape[1] // 2  # Flames are soft: half size is enough.
        self.mask = cv2.resize(alpha, (self.w, self.h), interpolation=cv2.INTER_AREA).astype(np.float32)
        self.strength = strength
        # Where flames start: the tops of the letters (a letter with no letter just above it), and faintly the rest,
        # so flames leap up off the words and the space between two lines stays clear.
        above = np.zeros_like(self.mask); lift = max(2, round(self.h * 0.008))
        above[lift:] = self.mask[:-lift]
        self.source = np.clip(_blur(np.clip(self.mask - above, 0, 1), 1.2) * 1.6 + self.mask * 0.12, 0, 1)
        self.n1 = _periodic_noise(self.h, self.w, seed, 18.0)
        self.n2 = _periodic_noise(self.h, self.w, seed + 1, 11.0)
        self.heights = _periodic_noise(self.h, self.w, seed + 3, 26.0)  # Each part of the fire its own height, changing.
        self.halo = _blur(self.mask, max(4.0, self.h * 0.025))
        ys, xs = np.nonzero(self.mask > 0.5)
        rng = np.random.default_rng(seed + 2)
        if ys.size:  # Embers leave from the tops of the letters.
            tops = ys < np.percentile(ys, 55)
            pick = rng.choice(np.flatnonzero(tops) if tops.any() else np.arange(ys.size), EMBERS)
            self.embers = np.stack([xs[pick], ys[pick], rng.uniform(0, 1, EMBERS), rng.uniform(0.6, 1.4, EMBERS), rng.uniform(0, 2 * math.pi, EMBERS)], 1)
        else:
            self.embers = np.zeros((0, 5))
        self.box = (ys.min(), ys.max()) if ys.size else (0, self.h)
        # One line's height (the tallest run of rows with letters): flames are sized to the letters, not the block.
        rows = np.concatenate([[False], self.mask.max(1) > 0.3, [False]]).astype(np.int8)
        edges = np.flatnonzero(np.diff(rows))
        self.line = float(max((b - a for a, b in zip(edges[::2], edges[1::2])), default=self.box[1] - self.box[0]))

    def frame(self, n: int) -> np.ndarray:
        """Frame n of the loop, RGB 0..1 at the full size."""
        import cv2
        t = (n % round(LOOP * FPS)) / (LOOP * FPS)  # 0..1 through the loop.
        # Noise scrolls up a whole height per loop (twice for the fine one), so the last frame meets the first.
        noise = 0.62 * np.roll(self.n1, -round(t * self.h), 0) + 0.38 * np.roll(self.n2, -round(2 * t * self.h), 0)
        sway = (np.sin(np.linspace(0, 2 * math.pi, self.h)[:, None] * 3 + 2 * math.pi * t) * 2).astype(np.float32)
        # How far a flame carries up: about the letters' height (more for a stronger fire), shorter where the noise is low.
        tall = max(8.0, self.line * 1.6 * self.strength)
        # Across the letters the flames reach different heights, from a quarter to one and a half times `tall`.
        reach = tall * (0.25 + 1.25 * np.clip((self.heights[round(t * self.h) % self.h] - 0.25) * 1.8, 0, 1))
        fade = 1 - 0.1 ** (1 / np.maximum(4.0, reach))
        heat = np.zeros((self.h, self.w), np.float32)
        carry = np.zeros(self.w, np.float32)
        for y in range(self.h - 1, -1, -1):  # Up from the bottom: each row keeps what rose from below, fading.
            carry = np.maximum(self.source[y], carry * (1 - fade * (0.45 + 1.1 * (1 - noise[y]))))
            heat[y] = carry
        heat = cv2.remap(heat, (np.arange(self.w, dtype=np.float32)[None, :] + sway * 9 * (noise - 0.5)).astype(np.float32),
                         np.repeat(np.arange(self.h, dtype=np.float32)[:, None], self.w, 1), cv2.INTER_LINEAR)
        # Separate tongues across the letters, each flickering with the fine noise.
        lick = np.clip((np.roll(self.n2, -round(3 * t * self.h), 0) - 0.28) * 2.2, 0, 1)  # Irregular tongues, flowing up.
        tongues = np.clip(heat ** 1.7 * (0.3 + 0.7 * lick) * (0.55 + noise) - 0.1, 0, 1) * 1.6 * self.strength
        core = self.mask * (0.45 + 0.35 * noise) * self.strength  # The letters glow from inside, like hot metal.
        light = _colour(np.clip(tongues + core * 0.8, 0, 1.2))
        light += self.halo[..., None] * np.array([0.55, 0.2, 0.04], np.float32) * self.strength
        sparks = np.zeros((self.h, self.w), np.float32)
        rise = self.line * 3.0
        for x0, y0, phase, speed, wob in self.embers:
            p = (t * speed + phase) % 1.0
            x = x0 + math.sin(wob + p * 6) * 6; y = y0 - p * rise
            if 0 <= x < self.w and 0 <= y < self.h:
                cv2.circle(sparks, (int(x), int(y)), 1, float((1 - p) ** 1.5), -1, cv2.LINE_AA)
        light += _blur(sparks, 0.8)[..., None] * np.array([1.0, 0.7, 0.3], np.float32) * 1.4
        return cv2.resize(np.clip(light, 0, 1), (self.full[1], self.full[0]), interpolation=cv2.INTER_LINEAR)


def make(item: Text, fmt: Format, strength: str = 'blaze', on_progress=lambda _: None) -> Path:
    """The burning clip for this title (made once): LOOP seconds, the frame's size, light on black."""
    from app.services.title_design import letters
    if strength not in STRENGTHS:
        raise ValueError('Choose glow, blaze or inferno.')
    target = target_path(item, fmt, strength)
    if target.is_file():
        return target
    alpha = letters(item.model_copy(update={'enter': None, 'exit': None}), fmt, plain=False)[..., 3]
    if alpha.max() <= 0.02:
        raise ValueError('This title has no letters to set on fire.')
    burner = Burner(alpha, STRENGTHS[strength])
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    total = round(LOOP * FPS)
    encode = subprocess.Popen([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{fmt.width}x{fmt.height}',
                               '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)],
                              stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for n in range(total):
            encode.stdin.write((burner.frame(n) * 255 + 0.5).astype(np.uint8).tobytes())
            if n % 10 == 0:
                on_progress(n * 98 // total)
        encode.stdin.close()
        if encode.wait():
            raise RuntimeError(f'Could not make the burning title: {encode.stderr.read()[-300:]!r}')
        temporary.replace(target)
    finally:
        if encode.poll() is None:
            encode.kill()
        temporary.unlink(missing_ok=True)
    on_progress(100)
    return target
