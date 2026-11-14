"""Particle-form, magic-form and magic-vanish for titles in the export, drawn as the preview draws them.

The preview (editor/playback.ts, titleParticle) breaks the title into a 150 x 90 grid of cells. Each cell shows the
title shifted by its own random amount, which shrinks to nothing as the animation ends; it is tinted blue, violet or
gold, and fades in at its own moment. Only the title's own pixels move, so the picture under it is never touched.

The export used to scramble the whole frame in fixed blocks instead (shufflepixels), which scattered a title's letters
over the entire video and, on a picture with magic-vanish, turned the whole picture to noise. Here the same maths as
the preview is applied with numpy to the title's picture, for the frames of its entrance and exit only; the frames in
between stay the title's own picture.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

GRID = (150.0, 90.0)
ENTERS = {'particle-form': 1, 'magic-form': 2}  # 1: particles; 2: magic, which travels less.
EXITS = {'particle-form': 1, 'magic-vanish': 2}
MAGIC = np.array([[.35, .85, 1.], [.85, .35, 1.], [1., .68, .18]], dtype=np.float32)


def _hash(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """filmHash in playback.ts: fract(sin(dot(p, (127.1, 311.7))) * 43758.5453123)."""
    value = np.sin(x * 127.1 + y * 311.7) * 43758.5453123
    return value - np.floor(value)


def _smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / np.maximum(edge1 - edge0, 1e-6), 0, 1)
    return t * t * (3 - 2 * t)


def particle_frame(rgba: np.ndarray, progress: float, mode: int) -> np.ndarray:
    """The title picture `rgba` (H x W x 4, uint8, straight alpha) part of the way (`progress`, 1 at rest) into its
    particles. mode 1 is particle-form, 2 is magic."""
    height, width = rgba.shape[:2]
    if progress >= 0.999:
        return rgba
    # Texture coordinates as the shader sees them: x to the right, y up from the bottom.
    u = (np.arange(width, dtype=np.float32) + 0.5) / width
    v = 1 - (np.arange(height, dtype=np.float32) + 0.5) / height
    cell_x = np.floor(u * GRID[0])[None, :]
    cell_y = np.floor(v * GRID[1])[:, None]
    rx, ry = _hash(cell_x + 13, cell_y + 13), _hash(cell_y + 71, cell_x + 71)
    travel = (1 - progress) ** 1.7 * (0.20 if mode == 2 else 0.34)
    su = u[None, :] + (rx - 0.5) * travel
    sv = v[:, None] + (ry - 0.5) * travel
    hue = _hash(cell_x + 109, cell_y + 109)
    # Nearest sample of the title at the shifted place; outside the picture is clear.
    columns = np.floor(su * width).astype(np.int32)
    rows = np.floor((1 - sv) * height).astype(np.int32)
    inside = (columns >= 0) & (columns < width) & (rows >= 0) & (rows < height)
    picked = rgba[np.clip(rows, 0, height - 1), np.clip(columns, 0, width - 1)].astype(np.float32) / 255
    picked[~inside] = 0
    tint = MAGIC[np.where(hue < .33, 0, np.where(hue < .66, 1, 2))]
    rgb = picked[..., :3] * (tint * (1 - progress) + progress)
    alpha = picked[..., 3] * _smoothstep(hue * .72, np.minimum(1, hue * .72 + .24), progress)
    out = np.dstack([rgb, alpha])
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


def moments(item, fps: int, frames: int) -> dict[int, tuple[int, float]]:
    """Frame of the title -> (mode, progress) where its particles show; as playback.ts decides it."""
    found: dict[int, tuple[int, float]] = {}
    for k in range(frames):
        local = k / fps
        if item.enter and item.enter.preset in ENTERS and local < item.enter.duration:
            found[k] = (ENTERS[item.enter.preset], min(1.0, local / item.enter.duration))
        elif item.exit and item.exit.preset in EXITS and local > item.length - item.exit.duration:
            found[k] = (EXITS[item.exit.preset], min(1.0, (item.length - local) / item.exit.duration))
    return found


def has_particles(item) -> bool:
    return bool((item.enter and item.enter.preset in ENTERS) or (item.exit and item.exit.preset in EXITS))


def sequence(item, fps: int, frames: int, picture_at: Callable[[float], Path], folder: Path, name: str) -> Path:
    """A numbered picture for every frame of the title (links, so the still frames cost nothing), read with -framerate
    exactly frame by frame. Returns the pattern for ffmpeg's -i."""
    target = folder / f'{name}-frames'
    target.mkdir(exist_ok=True)
    k = 0
    for path, count in listing(item, fps, frames, picture_at, folder, name):
        for _ in range(count):
            (target / f'{k:05d}.png').symlink_to(path.resolve())
            k += 1
    return target / '%05d.png'


def listing(item, fps: int, frames: int, picture_at: Callable[[float], Path], folder: Path, name: str) -> list[tuple[Path, int]]:
    """The title's pictures in order, each with how many frames it shows: its particle frames drawn into `folder`, and
    between them the picture it shows at that moment (`picture_at`, which changes for a karaoke title)."""
    shown = moments(item, fps, frames)
    rows: list[tuple[Path, int]] = []
    loaded: dict[Path, np.ndarray] = {}
    for k in range(frames):
        base = picture_at(k / fps)
        if k in shown:
            if base not in loaded:
                loaded[base] = np.asarray(Image.open(base).convert('RGBA'))
            mode, progress = shown[k]
            path = folder / f'{name}-particle{k}.png'
            Image.fromarray(particle_frame(loaded[base], progress, mode)).save(path, compress_level=1)
            rows.append((path, 1))
        elif rows and rows[-1][0] == base:
            rows[-1] = (base, rows[-1][1] + 1)
        else:
            rows.append((base, 1))
    return rows
