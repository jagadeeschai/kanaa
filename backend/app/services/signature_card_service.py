"""The signature title card, typeset as one piece (as a designer would lay it out, not as separate titles): the poet's
ink portrait draws itself on the left with their name beneath; on the right the song's title, its English name in
spaced capitals, a thin rule, then each credit as a small label over the name. Tamil and English share each font, so
both scripts sit at the same size; every gap is fixed. The words fade in once the portrait is drawn."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.services.portrait_sketch import sketch
from app.services.video_edit_service import LYRIC_FONTS_DIR

MAROON, INK, GREY, RULE = (107, 29, 29), (31, 27, 22), (138, 129, 120), (196, 160, 98)
FPS = 30


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(LYRIC_FONTS_DIR / name), size, layout_engine=ImageFont.Layout.RAQM)


def _spaced(text: str, spacing: str = ' ') -> str:
    return spacing.join(text)


def _pieces(width: int, height: int, segments: list[tuple[str, ImageFont.FreeTypeFont, tuple[int, int, int]]], centre_x: int, baseline: int) -> Image.Image:
    """One line made of pieces of different sizes on a shared baseline (a Tamil name, then | and its English
    spelling, smaller), centred on `centre_x`."""
    layer = Image.new('RGBA', (width, height))
    draw = ImageDraw.Draw(layer)
    widths = [draw.textlength(text, font=font) for text, font, _ in segments]
    x = centre_x - sum(widths) / 2
    for (text, font, colour), advance in zip(segments, widths):
        draw.text((x, baseline), text, font=font, fill=colour + (255,), anchor='ls')
        x += advance
    return layer


def _named(who: str, english: str | None, font, small, colour, width: int, height: int, centre_x: int, baseline: int) -> Image.Image:
    return _pieces(width, height, [(who, font, colour)] + ([('   |   ', small, GREY), (english, small, colour)] if english else []), centre_x, baseline)


def _block(width: int, height: int, items: list[tuple[str, ImageFont.FreeTypeFont, tuple[int, int, int], int]], centre_x: int) -> list[tuple[Image.Image, int]]:
    """Each line as its own see-through layer (so each can fade in on its own), centred on `centre_x`, from the
    given tops. items: (text, font, colour, top)."""
    layers = []
    for text, font, colour, top in items:
        layer = Image.new('RGBA', (width, height))
        draw = ImageDraw.Draw(layer)
        box = draw.textbbox((0, 0), text, font=font)
        draw.text((centre_x - (box[2] - box[0]) / 2 - box[0], top - box[1]), text, font=font, fill=colour + (255,))
        layers.append((layer, top))
    return layers


def make(photo: Path, paper: Path, target: Path, title: str, english: str, roles: list[list[str]], name: str | None, seconds: float = 6.0, name_english: str | None = None,
         size: tuple[int, int] = (1920, 1080), drawing: float = 2.4, radiance: bool = False) -> Path:
    import cv2
    width, height = size
    unit = height / 1080
    ground = np.asarray(Image.open(paper).convert('RGB').resize((width, height)), np.float32) / 255
    with tempfile.TemporaryDirectory() as folder:
        ink = np.asarray(Image.open(sketch(photo, Path(folder) / 'ink.png', framed=False)).convert('RGBA'), np.float32) / 255
    side = int(height * 0.58)
    alpha = cv2.resize(ink[..., 3], (side, side), interpolation=cv2.INTER_AREA)
    px, py = int(width * 0.3 - side / 2), int(height * 0.47 - side / 2)
    rng = np.random.default_rng(11)
    noise = cv2.GaussianBlur(rng.random((side, side)).astype(np.float32), (0, 0), side / 60)
    noise = (noise - noise.min()) / (np.ptp(noise) or 1)
    order = np.clip(0.55 * (1 - alpha) + 0.45 * noise, 0, 1)
    # The words, laid out on a fixed rhythm.
    right = int(width * 0.67)
    title_font, english_font = _font('Arima-Bold.ttf', round(88 * unit)), _font('Pavanam-Regular.ttf', round(24 * unit))
    label_font, name_font = _font('Pavanam-Regular.ttf', round(22 * unit)), _font('Catamaran-Bold.ttf', round(36 * unit))
    # The column is centred on the frame whatever the number of credits: title to last name is 316 + 112 per credit.
    shown = roles[:4]
    top = round((height - (316 + 112 * len(shown)) * unit) / 2 + 30 * unit)  # Level with the portrait and its name.
    lines, y = [(title, title_font, MAROON, top), (_spaced(english.upper()), english_font, GREY, top + round(122 * unit))], top + round(224 * unit)
    small = _font('Catamaran-Bold.ttf', round(26 * unit))
    named = []  # Name lines: the Tamil name, then | and the English name, smaller (roles may give a fourth item).
    for tamil, english_role, who, *also in shown:
        lines.append((f'{tamil}   ·   {english_role.upper()}', label_font, GREY, y))
        named.append(_named(who, also[0] if also else None, name_font, small, INK, width, height, right, y + round(70 * unit)))
        y += round(112 * unit)
    words = _block(width, height, lines, right)
    labels = words[2:]
    words = words[:2] + [pair for label, name_line in zip(labels, named) for pair in ((label[0], 0), (name_line, 0))]
    # Radiance behind the title: its own shape blurred into a golden glow, and faint rays fanning from it.
    title_mask = np.asarray(words[0][0], np.float32)[..., 3] / 255
    glow = cv2.GaussianBlur(title_mask, (0, 0), 22 * unit) * 1.6 + cv2.GaussianBlur(title_mask, (0, 0), 60 * unit) * 1.2
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    cy = top + 60 * unit
    angle, reach = np.arctan2(ys - cy, xs - right), np.hypot(xs - right, ys - cy) / (420 * unit)
    rays = (0.5 + 0.5 * np.cos(angle * 18)) ** 6 * np.exp(-reach ** 2) * (reach > 0.15)
    radiance = np.clip(glow * 0.55 + rays * 0.22, 0, 0.6)
    radiance_rgba = np.dstack([np.full_like(radiance, RULE[0] / 255), np.full_like(radiance, RULE[1] / 255), np.full_like(radiance, RULE[2] / 255), radiance])
    rule = Image.new('RGBA', (width, height))
    ImageDraw.Draw(rule).line([(right - round(70 * unit), top + round(176 * unit)), (right + round(70 * unit), top + round(176 * unit))], fill=RULE + (255,), width=max(1, round(2 * unit)))
    caption = [(_named(name, name_english, _font('Catamaran-Bold.ttf', round(34 * unit)), _font('Catamaran-Bold.ttf', round(24 * unit)), MAROON, width, height, int(width * 0.3),
                       py + side + round(48 * unit)), 0)] if name else []
    # When each part appears: the title just after the portrait starts, the credits one by one, the name once drawn.
    timed = [(words[0][0], 0.9), (words[1][0], 1.15), (rule, 1.3)] + [(layer, 1.5 + 0.18 * n) for n, (layer, _) in enumerate(words[2:])] + [(layer, 0.4 + drawing) for layer, _ in caption]
    layers = ([(radiance_rgba.astype(np.float32), 0.75)] if radiance else []) + [(np.asarray(layer, np.float32) / 255, start) for layer, start in timed]
    frames = max(2, round(seconds * FPS))
    target.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(FPS),
                                '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)], stdin=subprocess.PIPE)
    ink_colour = np.array([0.086, 0.078, 0.07], np.float32)
    gold = np.array(RULE, np.float32) / 255
    # The shine: once the portrait is drawn, a soft band of warm light crosses it once, slanting, and the ink gleams gold.
    shine_start, shine_time = 0.3 + drawing + 0.1, 0.9
    ys, xs = np.mgrid[0:side, 0:side].astype(np.float32)
    slant = (xs + ys * 0.5) / (side * 1.5)
    try:
        assert process.stdin is not None
        for n in range(frames):
            t = n / FPS
            out = 1.0 if t < seconds - 0.6 else max(0.0, (seconds - t) / 0.6)  # Everything eases away as the song begins.
            frame = ground.copy()
            p = min(1.0, max(0.0, (t - 0.3) / drawing))
            shown = alpha * np.clip((p * 1.25 - order) / 0.12, 0, 1) * out
            region = frame[py:py + side, px:px + side]
            q = (t - shine_start) / shine_time
            if 0 <= q <= 1:
                band = np.exp(-((slant - (q * 1.4 - 0.2)) / 0.07) ** 2)
                colour = ink_colour * (1 - band[..., None] * 0.85) + gold * band[..., None] * 0.85
                region[:] = region * (1 - shown[..., None]) + colour * shown[..., None]
                region[:] = region * (1 - band[..., None] * 0.06) + gold * band[..., None] * 0.06  # A faint warmth on the paper too.
            else:
                region[:] = region * (1 - shown[..., None]) + ink_colour * shown[..., None]
            for layer, start in layers:
                level = min(1.0, max(0.0, (t - start) / 0.6)) * out
                if level <= 0:
                    continue
                a = layer[..., 3:4] * level
                frame = frame * (1 - a) + layer[..., :3] * a
            process.stdin.write((frame * 255).astype(np.uint8).tobytes())
        process.stdin.close()
        if process.wait():
            raise RuntimeError('Could not make the signature card.')
    finally:
        if process.poll() is None:
            process.kill()
    return target
