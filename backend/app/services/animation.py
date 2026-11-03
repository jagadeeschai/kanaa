"""Enter and exit presets, looks and transitions. frontend/src/timeline/animation.ts holds the same math."""
from __future__ import annotations

import math

MAX_BLUR = 0.03  # Of the frame height.
# Opacity is always linear, so ffmpeg's fade filter can draw it exactly. The value is the share of the animation it takes.
OPACITY_SPAN = {'fade': 1, 'zoom': 1, 'pop': 1 / 3, 'blur': 1, 'bounce': 1 / 3}
XFADE_NAMES = {'crossfade': 'fade', 'wipe': 'wipeleft', 'slide': 'slideleft', 'zoom': 'zoomin', 'flash': 'fadewhite', 'dip': 'fadeblack', 'whip': 'slideleft'}
WHIP_BLUR = 0.05  # Peak horizontal blur of a whip, as a share of the frame height. Matches animation.ts.
# Red, green and blue gain, contrast, saturation.
LOOKS = {'none': (1, 1, 1, 1, 1), 'warm': (1.08, 1, 0.9, 1.02, 1.05), 'cool': (0.92, 1, 1.1, 1.02, 1), 'mono': (1, 1, 1, 1.1, 0),
         'vivid': (1, 1, 1, 1.1, 1.35), 'film': (1.03, 1, 0.96, 0.88, 0.85)}
SLIDES = {'slide-up': (0, 1), 'slide-down': (0, -1), 'slide-left': (1, 0), 'slide-right': (-1, 0)}


def ease_out(p: float) -> float:
    return 1 - (1 - p) ** 3


def look_at(preset: str, p: float) -> dict[str, float]:
    """The item's state `p` of the way through a preset: 0 is the hidden end, 1 is at rest."""
    p = min(1, max(0, p))
    e = ease_out(p)
    span = OPACITY_SPAN.get(preset)
    look = {'dx': 0.0, 'dy': 0.0, 'scale': 1.0, 'opacity': min(1, p / span) if span else 1.0, 'blur': 0.0}
    if preset in SLIDES:
        x, y = SLIDES[preset]
        look.update(dx=x * (1 - e), dy=y * (1 - e))
    elif preset == 'zoom':
        look['scale'] = 0.6 + 0.4 * e
    elif preset == 'pop':
        look['scale'] = max(0.01, 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2)
    elif preset == 'blur':
        look['blur'] = (1 - e) * MAX_BLUR
    elif preset == 'bounce':
        look['dy'] = -0.6 * abs(math.cos(3 * math.pi * p)) * (1 - p) ** 2
    return look


def offset_expression(preset: str, axis: str, p: str) -> str | None:
    if preset in SLIDES:
        amount = SLIDES[preset][0 if axis == 'dx' else 1]
        return f'({amount}*pow(1-{p},3))' if amount else None
    if preset == 'bounce' and axis == 'dy':
        return f'(-0.6*abs(cos({3 * math.pi}*{p}))*pow(1-{p},2))'
    return None


def scale_expression(preset: str, p: str) -> str | None:
    if preset == 'zoom':
        return f'(0.6+0.4*(1-pow(1-{p},3)))'
    if preset == 'pop':
        return f'max(0.01,1+2.7*pow({p}-1,3)+1.7*pow({p}-1,2))'
    return None


def chroma_yuv(color: str) -> tuple[int, int, int]:
    """A #rrggbb colour as limited-range BT.709, the form video is keyed in."""
    r, g, b = (int(color[index:index + 2], 16) / 255 for index in (1, 3, 5))
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return round(16 + 219 * luma), round(128 + 224 * (b - luma) / 1.8556), round(128 + 224 * (r - luma) / 1.5748)
