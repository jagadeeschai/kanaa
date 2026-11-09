"""Laid-out titles: the words drawn by libass as every title is, then placed with bars or apart in the same picture.

The picture is made once here and both the preview (/api/text-image) and the export use it, so they cannot differ.
- gradient: a bar behind the words from the left edge, solid under them and fading out to the right.
- formal: a light bar across the whole frame with two fine rules, the words centred on it.
- overlap: the subtitle tucked over the end of the title, in its own colour.
- corners: the title in the top left corner and the subtitle in the bottom right.
Bars take `band_color` (black for a gradient, ivory for formal when none is chosen); the words are drawn plain on a bar.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from app.services.timeline_schema import Format, Text

ALPHA_EDGE = 8  # Out of 255: what counts as part of the letters when measuring them.
BAR_OPACITY = 0.85
GRADIENT_FADE = 0.3  # Of the frame width: how far past the words the gradient bar fades out.
FORMAL_COLOUR, FORMAL_RULE = '#f4ecdc', '#b08d57'
OVERLAP_TUCK = 0.22  # Of the title's height: how far the subtitle reaches back over the end of the title.
CORNER_MARGIN = 0.06  # Of the frame height, from the corners.


def _hex(colour: str) -> np.ndarray:
    return np.array([int(colour[at:at + 2], 16) / 255 for at in (1, 3, 5)], np.float32)


def letters(item: Text, fmt: Format, plain: bool) -> np.ndarray:
    """The words alone as straight RGBA in 0..1, the frame's size, through the same libass path as any title."""
    from app.services.timeline_service import write_title
    from app.services.video_edit_service import LYRIC_FONTS_DIR
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        write_title(folder / 'title.ass', item.model_copy(update={'design': None}), fmt, plain=plain)
        (folder / 'fonts').symlink_to(LYRIC_FONTS_DIR)
        result = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=black@0:s={fmt.width}x{fmt.height}:r=30:d=0.5,format=rgba',
                                 '-vf', 'ass=filename=title.ass:shaping=complex:fontsdir=fonts:alpha=1', '-frames:v', '1', '-update', '1', 'out.png'],
                                cwd=folder, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Could not render the text on this timeline.')
        return np.asarray(Image.open(folder / 'out.png').convert('RGBA'), np.float32) / 255


def box_of(picture: np.ndarray) -> tuple[int, int, int, int] | None:
    """The letters' box (x0, y0, x1, y1), exclusive at the end, or None when nothing is drawn."""
    rows, cols = np.nonzero(picture[..., 3] * 255 > ALPHA_EDGE)
    return (int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1) if rows.size else None


def over(top: np.ndarray, under: np.ndarray) -> np.ndarray:
    """Straight RGBA `top` over `under`."""
    a, b = top[..., 3:4], under[..., 3:4]
    alpha = a + b * (1 - a)
    rgb = np.where(alpha > 1e-6, (top[..., :3] * a + under[..., :3] * b * (1 - a)) / np.maximum(alpha, 1e-6), 0)
    return np.concatenate([rgb, alpha], -1)


def moved(picture: np.ndarray, dx: int, dy: int) -> np.ndarray:
    """The picture shifted by whole pixels, the uncovered part clear."""
    out = np.zeros_like(picture)
    height, width = picture.shape[:2]
    xs, ys = slice(max(0, dx), min(width, width + dx)), slice(max(0, dy), min(height, height + dy))
    out[ys, xs] = picture[max(0, -dy):height - max(0, dy), max(0, -dx):width - max(0, dx)]
    return out


def bar(shape: tuple[int, int], colour: str, top: int, bottom: int, alpha_along_x: np.ndarray) -> np.ndarray:
    height, width = shape
    out = np.zeros((height, width, 4), np.float32)
    out[top:bottom, :, :3] = _hex(colour)
    out[top:bottom, :, 3] = alpha_along_x[None, :]
    return out


def design_picture(item: Text, fmt: Format) -> np.ndarray:
    width, height = fmt.width, fmt.height
    unit = width / 720
    pad = round(0.35 * max(20, item.size) * unit)
    if item.design in ('gradient', 'formal'):
        # A gradient bar runs from the left edge, so its words sit on the left; a formal bar's words are centred.
        words = letters(item.model_copy(update={'align': 'left' if item.design == 'gradient' else 'center'}), fmt, plain=True)
        box = box_of(words)
        if box is None:
            return words
        top, bottom = max(0, box[1] - pad), min(height, box[3] + pad)
        xs = np.arange(width, dtype=np.float32) + 0.5
        if item.design == 'gradient':
            solid = min(width, box[2] + pad)
            fade = max(1.0, GRADIENT_FADE * width)
            alpha = BAR_OPACITY * np.clip(1 - (xs - solid) / fade, 0, 1)
            behind = bar((height, width), item.band_color or '#000000', top, bottom, alpha)
        else:
            behind = bar((height, width), item.band_color or FORMAL_COLOUR, top, bottom, np.full(width, 0.94, np.float32))
            rule = max(1, round(1.2 * unit))
            gap = max(2, round(0.18 * pad))
            colour = _hex(item.subtitle_color or FORMAL_RULE)
            inner = (xs > 0.06 * width) & (xs < 0.94 * width)
            for y in (top + gap, bottom - gap - rule):
                behind[y:y + rule, inner, :3] = colour
                behind[y:y + rule, inner, 3] = 1
        return over(words, behind)
    if item.design == 'overlap':
        title = letters(item.model_copy(update={'subtitle': None}), fmt, plain=False)
        if not item.subtitle:
            return title
        sub = letters(item.model_copy(update={'text': item.subtitle, 'subtitle': None, 'size': item.subtitle_size or round(max(20, item.size) * 0.55),
                                              'color': item.subtitle_color or item.color, 'spacing': item.subtitle_spacing}), fmt, plain=False)
        a, b = box_of(title), box_of(sub)
        if a is None or b is None:
            return over(sub, title)
        tall = a[3] - a[1]
        # The subtitle's left edge reaches back over the end of the title, its bottom a little below the title's.
        dx, dy = round(a[2] - OVERLAP_TUCK * tall - b[0]), round(a[3] + 0.12 * tall - b[3])
        # The pair's box, worked out before anything is moved, so neither part is cut at the frame's edge.
        left, right = min(a[0], b[0] + dx), max(a[2], b[2] + dx)
        # Keep the pair where the title alone would sit: centred, or against its side, and inside the frame.
        target = {'left': a[0], 'right': a[2] - (right - left), 'center': round((a[0] + a[2]) / 2 - (right - left) / 2)}[item.align]
        target = min(max(target, 0), max(0, width - (right - left)))
        shift = target - left
        return over(moved(sub, dx + shift, dy), moved(title, shift, 0))
    if item.design == 'corners':
        margin = round(CORNER_MARGIN * height)
        title = letters(item.model_copy(update={'subtitle': None, 'position': 'top', 'align': 'left'}), fmt, plain=False)
        pictures = [(title, 'top left')]
        if item.subtitle:
            sub = letters(item.model_copy(update={'text': item.subtitle, 'subtitle': None, 'position': 'bottom', 'align': 'right',
                                                  'size': item.subtitle_size or round(max(20, item.size) * 0.55), 'color': item.subtitle_color or item.color,
                                                  'spacing': item.subtitle_spacing}), fmt, plain=False)
            pictures.append((sub, 'bottom right'))
        out = np.zeros((height, width, 4), np.float32)
        for picture, corner in pictures:
            box = box_of(picture)
            if box is None:
                continue
            dx = margin - box[0] if corner == 'top left' else width - margin - box[2]
            dy = margin - box[1] if corner == 'top left' else height - margin - box[3]
            out = over(moved(picture, dx, dy), out)
        return out
    return letters(item, fmt, plain=False)


def render_design(item: Text, fmt: Format, target: Path) -> None:
    picture = design_picture(item, fmt)
    Image.fromarray(np.clip(picture * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(target)
