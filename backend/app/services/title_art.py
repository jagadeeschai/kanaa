"""Drawn backings for laid-out titles (title_design.py): a cloud bank, a torn paper strip, a band with a torn top edge,
and curling flourishes either side of the words. Drawn in code at twice the size and shrunk, so edges are smooth;
the randomness is seeded, so the same title always gets the same shapes (the preview and export share the picture).
Each returns straight RGBA in 0..1, the frame's size, to lay under (or around) the words.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SUPER = 2  # Drawn this much larger, then shrunk, for smooth edges.
CLOUD_COLOUR, PAPER_COLOUR, TORN_COLOUR, TEAR_COLOUR = '#8ecae6', '#f4f1ea', '#141414', '#f3efe4'


def _rgb(colour: str) -> tuple[int, int, int]:
    return tuple(int(colour[at:at + 2], 16) for at in (1, 3, 5))


def _canvas(width: int, height: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new('RGBA', (width * SUPER, height * SUPER), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def _done(image: Image.Image, width: int, height: int, blur: float = 0) -> np.ndarray:
    if blur > 0:
        image = image.filter(ImageFilter.GaussianBlur(blur * SUPER))
    small = image.resize((width, height), Image.LANCZOS)
    return np.asarray(small, np.float32) / 255


def _rough(start: float, end: float, base: float, step: float, wobble: float, rng: np.random.Generator) -> list[tuple[float, float]]:
    """Points along a torn edge from `start` to `end` (along x), wandering about `base` by up to `wobble`."""
    count = max(2, int(abs(end - start) / max(step, 1)))
    xs = np.linspace(start, end, count + 1)
    slow = np.cumsum(rng.normal(0, wobble * 0.35, xs.size))
    slow -= np.linspace(slow[0], slow[-1], xs.size)  # Starts and ends on the base line.
    fast = rng.uniform(-wobble, wobble, xs.size) * 0.6
    return [(float(x), float(base + s + f)) for x, s, f in zip(xs, slow, fast)]


def clouds(box, size, item, unit: float) -> np.ndarray:
    """A puffy cloud behind the words: bumps along its top and round ends, a flat bottom, and a light rim on top."""
    width, height = size
    pad = 0.35 * max(20, item.size) * unit
    x0, y0, x1, y1 = box
    tall = (y1 - y0) + 2 * pad
    colour = _rgb(item.band_color or CLOUD_COLOUR)
    light = tuple(min(255, round(c + (255 - c) * 0.55)) for c in colour)
    left, right, bottom = x0 - 1.2 * pad, x1 + 1.2 * pad, y1 + pad
    rng = np.random.default_rng(11)
    bumps, x = [], left + 0.45 * tall
    while x < right - 0.45 * tall:
        bumps.append((x, y0 - 0.1 * pad + rng.uniform(-0.12, 0.12) * tall, tall * rng.uniform(0.32, 0.5)))
        x += tall * rng.uniform(0.38, 0.55)
    bumps.append((right - 0.45 * tall, y0 + 0.05 * tall, tall * 0.42))
    ends = [(left + 0.45 * tall, y0 + 0.35 * tall, 0.45 * tall), (right - 0.45 * tall, y0 + 0.35 * tall, 0.45 * tall)]
    image, draw = _canvas(width, height)

    def bank(shade, drop):
        for cx, cy, r in [*bumps, *ends]:
            draw.ellipse([(cx - r) * SUPER, (cy - r + drop) * SUPER, (cx + r) * SUPER, (cy + r + drop) * SUPER], fill=(*shade, 255))
        # The body starts at the same height in both, so the rim only shows along the bumps.
        # It starts high enough that every bump overlaps it: no gap shows through under a small bump.
        draw.rounded_rectangle([left * SUPER, (y0 + 0.05 * tall) * SUPER, right * SUPER, bottom * SUPER], radius=0.45 * tall * SUPER, fill=(*shade, 255))
    bank(light, 0)  # The rim: the whole cloud in the light colour,
    bank(colour, 0.07 * tall)  # then the cloud itself a little lower, leaving light along the top.
    out = _done(image, width, height, blur=0.6 * unit)
    out[..., 3] *= 0.96
    return out


def paper(box, size, item, unit: float) -> np.ndarray:
    """A strip of paper behind the words, torn at both ends, with a little grain and a soft shadow."""
    width, height = size
    rng = np.random.default_rng(23)
    pad = 0.35 * max(20, item.size) * unit
    x0, y0, x1, y1 = box
    left, right, top, bottom = x0 - 1.3 * pad, x1 + 1.3 * pad, y0 - pad, y1 + pad
    step, wobble = 3 * unit, 0.18 * pad
    left_edge = [(x + left, y) for y, x in _rough(top, bottom, 0, step, wobble, rng)]
    right_edge = [(x + right, y) for y, x in _rough(bottom, top, 0, step, wobble, rng)]
    shape = [(x * SUPER, y * SUPER) for x, y in [*left_edge, *right_edge]]
    shadow, draw = _canvas(width, height)
    offset = 3 * unit * SUPER
    draw.polygon([(x + offset, y + offset) for x, y in shape], fill=(0, 0, 0, 110))
    out = _done(shadow, width, height, blur=3 * unit)
    image, draw = _canvas(width, height)
    draw.polygon(shape, fill=(*_rgb(item.band_color or PAPER_COLOUR), 255))
    strip = _done(image, width, height)
    grain = np.random.default_rng(29).normal(0, 0.025, (height, width, 1)).astype(np.float32)
    strip[..., :3] = np.clip(strip[..., :3] + grain, 0, 1)
    return _over(strip, out)


def torn(box, size, item, unit: float) -> np.ndarray:
    """A band across the frame from below the words up past them, its top edge torn, with pale paper fibres along the tear."""
    width, height = size
    rng = np.random.default_rng(37)
    pad = 0.35 * max(20, item.size) * unit
    x0, y0, x1, y1 = box
    # A lower third's band runs to the bottom of the frame; elsewhere it ends a little below the words.
    top, bottom = y0 - 1.3 * pad, height if item.position == 'bottom' else min(height, y1 + 1.6 * pad)
    edge = _rough(-4, width + 4, top, 4 * unit, 0.22 * pad, rng)
    fibres = [(x, y - rng.uniform(0.6, 2.4) * unit) for x, y in edge]
    image, draw = _canvas(width, height)
    draw.polygon([(x * SUPER, y * SUPER) for x, y in [*fibres, (width + 4, bottom), (-4, bottom)]], fill=(*_rgb(TEAR_COLOUR), 255))
    draw.polygon([(x * SUPER, y * SUPER) for x, y in [*edge, (width + 4, bottom), (-4, bottom)]], fill=(*_rgb(item.band_color or TORN_COLOUR), 255))
    return _done(image, width, height)


def organic(box, size, item, unit: float) -> np.ndarray:
    """Curling vines with leaves reaching out either side of the words, and a fine line beneath them with a diamond."""
    width, height = size
    pad = 0.35 * max(20, item.size) * unit
    x0, y0, x1, y1 = box
    colour = (*_rgb(item.subtitle_color or item.color), 255)
    image, draw = _canvas(width, height)
    stroke = max(2, round(2.2 * unit * SUPER))
    # Sized and placed by the title line, not the subtitle under it.
    title_px = max(20, item.size) * unit
    middle = min((y0 + y1) / 2, y0 + 0.62 * title_px)
    reach = min(1.5 * title_px, 0.16 * width)
    curl_at = 0.62
    for side in (-1, 1):
        start = x0 - 0.3 * pad if side < 0 else x1 + 0.3 * pad
        wave = lambda t: middle + 0.28 * reach * math.sin(math.pi * t * 1.6)  # noqa: E731
        points = [(start + side * reach * t, wave(t)) for t in np.linspace(0, curl_at, 50)]
        # The end curls inwards and upwards into a spiral that tightens.
        cx, cy = start + side * reach * curl_at, wave(curl_at)
        radius0 = 0.3 * reach
        centre = (cx, cy - radius0)
        for t in np.linspace(0, 1, 60):
            angle = t * 1.75 * math.pi
            radius = radius0 * (1 - 0.7 * t)
            points.append((centre[0] + side * radius * math.sin(angle), centre[1] + radius * math.cos(angle)))
        draw.line([(x * SUPER, y * SUPER) for x, y in points], fill=colour, width=stroke, joint='curve')
        for at, tilt in ((10, -1), (22, 1), (34, -1)):
            px, py = points[at]
            leaf = 0.16 * reach
            lx, ly = px + side * leaf * 0.15, py + tilt * leaf * 0.55
            draw.ellipse([(lx - leaf * 0.5) * SUPER, (ly - leaf * 0.24) * SUPER, (lx + leaf * 0.5) * SUPER, (ly + leaf * 0.24) * SUPER], fill=colour)
    line_y = (y1 + 0.55 * pad) * SUPER
    draw.line([(x0 + 0.4 * pad) * SUPER, line_y, (x1 - 0.4 * pad) * SUPER, line_y], fill=colour, width=max(1, stroke // 2))
    diamond = 0.28 * pad * SUPER
    mx = (x0 + x1) / 2 * SUPER
    draw.polygon([(mx, line_y - diamond), (mx + diamond, line_y), (mx, line_y + diamond), (mx - diamond, line_y)], fill=colour)
    return _done(image, width, height)


def _over(top: np.ndarray, under: np.ndarray) -> np.ndarray:
    a, b = top[..., 3:4], under[..., 3:4]
    alpha = a + b * (1 - a)
    rgb = np.where(alpha > 1e-6, (top[..., :3] * a + under[..., :3] * b * (1 - a)) / np.maximum(alpha, 1e-6), 0)
    return np.concatenate([rgb, alpha], -1)


ART = {'clouds': clouds, 'paper': paper, 'torn': torn, 'organic': organic}
