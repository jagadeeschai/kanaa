"""Credit lettering made as pictures, for words over the song's scenes: gradient white letters (bright white at the
top warming to soft ivory below), a soft shadow so they read on any picture, no box behind, and optionally a golden
radiance. Each is a full-frame picture with a see-through background, laid over the video as it is."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.services.video_edit_service import LYRIC_FONTS_DIR

TOP, BOTTOM = (255, 255, 255), (238, 226, 200)  # White to warm ivory.
GOLD = (214, 172, 96)


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(LYRIC_FONTS_DIR / name), size, layout_engine=ImageFont.Layout.RAQM)


def make(lines: list[tuple[str, str, int]], at: tuple[float, float], target: Path, align: str = 'left', radiance: bool = False,
         size: tuple[int, int] = (1920, 1080), gap: float = 0.35) -> Path:
    """lines: (text, font file, size in pixels at 1080p), top to bottom. at: where the block's top-left (align left)
    or top-centre (align centre) goes, as shares of the frame."""
    width, height = size
    unit = height / 1080
    mask = Image.new('L', size)
    draw = ImageDraw.Draw(mask)
    x0, y = at[0] * width, at[1] * height
    for text, font_name, px in lines:
        font = _font(font_name, round(px * unit))
        box = draw.textbbox((0, 0), text, font=font)
        x = x0 - box[0] if align == 'left' else x0 - (box[2] - box[0]) / 2 - box[0]
        draw.text((x, y - box[1]), text, font=font, fill=255)
        y += (box[3] - box[1]) + px * gap * unit
    alpha = np.asarray(mask, np.float32) / 255
    rows = np.nonzero(alpha.max(axis=1) > 0)[0]
    first, last = (rows.min(), rows.max()) if len(rows) else (0, height - 1)
    share = np.clip((np.arange(height, dtype=np.float32) - first) / max(1, last - first), 0, 1)[:, None, None]
    fill = np.array(TOP, np.float32) * (1 - share) + np.array(BOTTOM, np.float32) * share
    # Two shadows, close and wide, so even small letters read over a white cloth or a bright sky.
    shadow = np.clip(np.asarray(mask.filter(ImageFilter.GaussianBlur(3 * unit)), np.float32) / 255 * 1.1 + np.asarray(mask.filter(ImageFilter.GaussianBlur(14 * unit)), np.float32) / 255 * 0.7, 0, 0.85)
    out_rgb = np.zeros((height, width, 3), np.float32)
    out_a = shadow.copy()
    if radiance:
        glow = np.asarray(mask.filter(ImageFilter.GaussianBlur(26 * unit)), np.float32) / 255
        glow = np.clip(glow * 3.2, 0, 0.85)
        out_rgb = out_rgb * (1 - glow[..., None]) + np.array(GOLD, np.float32) / 255 * glow[..., None]
        out_a = np.maximum(out_a * (1 - glow), glow)
    out_rgb = out_rgb * (1 - alpha[..., None]) + fill / 255 * alpha[..., None]
    out_a = np.maximum(out_a, alpha)
    rgba = np.dstack([out_rgb, out_a])
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA').save(target)
    return target
