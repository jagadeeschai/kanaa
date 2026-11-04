"""The cinematic finish over the whole frame: a teal and orange grade, glow on the highlights, a vignette, film grain and
letterbox bars. Applied after the picture and titles, before captions, so captions stay readable over the bars.

frontend/src/editor/playback.ts (FINISH) does the same maths for the preview. The grade goes to ffmpeg as a 3D LUT and
the vignette as a mask picture, both made from these formulas, so the two match; the grain is random in both.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

LUT_SIZE = 33
SHADOWS = np.array([-0.06, 0.02, 0.07])  # Teal, for the dark parts.
HIGHLIGHTS = np.array([0.08, 0.02, -0.07])  # Orange, for the bright parts: skin and light.
GLOW_RADIUS = 0.03  # Of the frame height: the glow's Gaussian sigma.
GRAIN_SPAN = 0.16  # At full grain, noise runs ±8% of full brightness.
BARS_RATIO = 2.39  # Scope: the widescreen cinema frame.
VIGNETTE_FROM, VIGNETTE_TO = 0.45, 1.05  # Where the darkening starts and is complete, from centre (0) to corner (1).


def smoothstep(low: float, high: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def tone(rgb: np.ndarray, amount: float) -> np.ndarray:
    """Teal shadows, orange highlights. rgb is 0 to 1, last axis the channels."""
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722])
    shadow = 1 - smoothstep(0, 0.55, luma)
    high = smoothstep(0.45, 1, luma)
    return np.clip(rgb + amount * (shadow[..., None] * SHADOWS + high[..., None] * HIGHLIGHTS), 0, 1)


def write_lut(path: Path, amount: float) -> Path:
    """The grade as a .cube LUT: red changes fastest, as the format asks."""
    steps = np.linspace(0, 1, LUT_SIZE)
    blue, green, red = np.meshgrid(steps, steps, steps, indexing='ij')
    graded = tone(np.stack([red, green, blue], axis=-1).reshape(-1, 3), amount)
    lines = [f'LUT_3D_SIZE {LUT_SIZE}', *(f'{r:.6f} {g:.6f} {b:.6f}' for r, g, b in graded)]
    path.write_text('\n'.join(lines) + '\n')
    return path


def vignette_mask(width: int, height: int, amount: float) -> np.ndarray:
    """1 in the middle, darker toward the corners."""
    aspect = width / height
    ys, xs = np.mgrid[0:height, 0:width]
    dx = ((xs + 0.5) / width - 0.5) * aspect
    dy = (ys + 0.5) / height - 0.5
    reach = np.hypot(dx, dy) / np.hypot(aspect * 0.5, 0.5)
    return 1 - amount * smoothstep(VIGNETTE_FROM, VIGNETTE_TO, reach)


def bar_share(width: int, height: int) -> float:
    """Each bar's height as a share of the frame. None for upright or already-wide frames."""
    aspect = width / height
    return max(0.0, (1 - aspect / BARS_RATIO) / 2) if aspect >= 1 else 0.0


def finish_filters(finish, width: int, height: int, folder: Path, label: str, source: str) -> tuple[list[str], str, list[str]]:
    """Graph lines from `source` to the finished label, and any extra inputs (the vignette mask)."""
    steps, current, inputs = [], source, []

    def step(text: str) -> None:
        nonlocal current
        out = f'{label}_{len(steps)}'
        steps.append(f'[{current}]{text}[{out}]')
        current = out

    if finish.grade > 0:
        lut = write_lut(folder / f'{label}-grade.cube', finish.grade)
        step(f"lut3d=file='{lut.as_posix()}':interp=trilinear")
    if finish.glow > 0:
        small = (max(2, width // 4 // 2 * 2), max(2, height // 4 // 2 * 2))
        sigma = GLOW_RADIUS * height * small[1] / height
        threshold = "'clip((val-128)*2,0,255)'"
        steps += [f'[{current}]split=2[{label}_base][{label}_light]',
                  f'[{label}_light]scale={small[0]}:{small[1]},lutrgb=r={threshold}:g={threshold}:b={threshold},gblur=sigma={sigma:.3f},scale={width}:{height}:flags=bicubic[{label}_halo]',
                  f'[{label}_base][{label}_halo]blend=all_mode=screen:all_opacity={finish.glow:.3f}[{label}_glow]']
        current = f'{label}_glow'
    if finish.vignette > 0:
        mask = folder / f'{label}-vignette.png'
        Image.fromarray(np.round(vignette_mask(width, height, finish.vignette) * 255).astype(np.uint8)).convert('RGB').save(mask)
        inputs = ['-loop', '1', '-i', str(mask)]
        steps.append(f'[MASK]format=gbrp[{label}_mask]')
        steps.append(f'[{current}][{label}_mask]blend=all_mode=multiply:shortest=1[{label}_dark]')
        current = f'{label}_dark'
    if finish.grain > 0:
        step(f'format=yuv444p,noise=c0s={finish.grain * GRAIN_SPAN * 255 / 2:.2f}:c0f=t+u,format=gbrp')
    bar = round(bar_share(width, height) * height) if finish.letterbox else 0
    if bar > 0:
        step(f'drawbox=x=0:y=0:w=iw:h={bar}:color=black:t=fill,drawbox=x=0:y=ih-{bar}:w=iw:h={bar}:color=black:t=fill')
    return steps, current, inputs
