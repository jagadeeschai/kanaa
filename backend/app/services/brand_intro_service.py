"""Brand intro: a plain golden leaf falls among floating music notes, strikes them in a soft burst of light, the
note appears in the leaf as they are drawn in, the lettering grows out of it, and "வழங்கும்" with "PRESENTS" fades
in beneath. Drawn frame by frame from the owner's own logo picture (a transparent PNG), so the brand is exact.

The logo's largest shape is taken as the leaf (any cut-out inside it, such as the note, appears only after the
strike); the rest of the logo is the lettering. Made once per logo, size and words, and kept with the media.
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.job_service import JobCancelled

FPS = 30
SECONDS = 5.5
VERSION = 1
GOLD = (236, 184, 78)
FONTS = Path(__file__).resolve().parents[1] / 'assets' / 'fonts'
TAMIL_FONT = FONTS / 'Arima-Bold.ttf'
NOTE_FONTS = ['/System/Library/Fonts/Apple Symbols.ttf', '/Library/Fonts/Arial Unicode.ttf', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf']
CAPS_FONTS = ['/System/Library/Fonts/Avenir Next.ttc', '/System/Library/Fonts/Helvetica.ttc', str(FONTS / 'NotoSans-Bold.ttf')]
# When each part happens, in seconds.
HIT, MERGED, WORDS, PRESENTS, FADE = 1.8, 2.3, 2.2, 3.0, 4.8
DEFAULT_TAMIL, DEFAULT_ENGLISH = 'வழங்கும்', 'PRESENTS'


def intro_path(logo: Path, width: int, height: int, tamil: str, english: str) -> Path:
    ident = json.dumps([VERSION, hashlib.sha256(logo.read_bytes()).hexdigest()[:16], width, height, tamil, english], ensure_ascii=False)
    return settings.data_dir / 'media' / f'brand-intro-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def _font(names: list[str], size: int):
    from PIL import ImageFont
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _ease(p: float) -> float:
    p = min(1.0, max(0.0, p))
    return p * p * (3 - 2 * p)


class Intro:
    """Everything that does not change between frames: the logo's parts and where they go."""

    def __init__(self, logo: Path, width: int, height: int, tamil: str, english: str):
        import cv2
        from PIL import Image, ImageDraw, ImageFilter, ImageFont
        self.Image, self.ImageDraw, self.ImageFilter = Image, ImageDraw, ImageFilter
        W, H = self.W, self.H = width, height
        rng = np.random.default_rng(7)
        picture = Image.open(logo).convert('RGBA')
        pixels = np.array(picture)
        alpha = pixels[..., 3]
        if (alpha < 250).mean() < 0.05:
            raise ValueError('The brand intro needs a logo with a transparent background (a PNG).')
        _, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 40).astype(np.uint8), 8)
        leaf = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        x, y, w, h = (int(v) for v in stats[leaf][:4])
        pad = max(8, round(max(w, h) * 0.06))
        leaf_mask = cv2.dilate((labels == leaf).astype(np.uint8), np.ones((pad, pad), np.uint8)) > 0
        leaf_px = pixels.copy(); leaf_px[~leaf_mask, 3] = 0
        rest_px = pixels.copy(); rest_px[leaf_mask, 3] = 0
        # Cut-outs inside the leaf (its note) are filled with the leaf's own gold for the plain falling leaf.
        gaps = 1 - (alpha[y:y + h, x:x + w] > 40).astype(np.uint8)
        count, gap_labels, gap_stats, _ = cv2.connectedComponentsWithStats(gaps, 8)
        inside = np.zeros(alpha.shape, bool)
        for g in range(1, count):
            gx, gy, gw, gh = gap_stats[g][:4]
            if gx > 0 and gy > 0 and gx + gw < w and gy + gh < h:
                inside[y:y + h, x:x + w] |= gap_labels == g
        plain_px = leaf_px.copy()
        fill = cv2.dilate(inside.astype(np.uint8), np.ones((15, 15), np.uint8))
        if fill.any():
            painted = cv2.inpaint(np.ascontiguousarray(leaf_px[..., :3]), fill, 25, cv2.INPAINT_TELEA)
            smooth = cv2.GaussianBlur(painted, (0, 0), 18)
            soft = cv2.GaussianBlur(fill.astype(np.float32), (0, 0), 6)[..., None]
            plain_px[..., :3] = (painted * (1 - soft) + smooth * soft).astype(np.uint8)
            plain_px[fill > 0, 3] = 255
        scale = (W * 0.5) / picture.width
        if picture.height * scale > H * 0.55:
            scale = H * 0.55 / picture.height
        self.size = (round(picture.width * scale), round(picture.height * scale))
        self.origin = ((W - self.size[0]) // 2, int(H * 0.40) - self.size[1] // 2)
        crop = tuple(round(v * scale) for v in (x - pad, y - pad, x + w + pad, y + h + pad))
        self.leaf = Image.fromarray(leaf_px).resize(self.size, Image.LANCZOS).crop(crop)
        self.plain = Image.fromarray(plain_px).resize(self.size, Image.LANCZOS).crop(crop)
        self.rest = np.array(Image.fromarray(rest_px).resize(self.size, Image.LANCZOS))
        self.home = (self.origin[0] + round((x + w / 2) * scale), self.origin[1] + round((y + h / 2) * scale))
        note_font = _font(NOTE_FONTS, round(H * 0.11))

        def glyph(char):
            box = note_font.getbbox(char)
            im = Image.new('RGBA', (box[2] + 20, box[3] + 20), (0, 0, 0, 0))
            ImageDraw.Draw(im).text((10, 10), char, font=note_font, fill=GOLD + (255,))
            return Image.alpha_composite(im.filter(ImageFilter.GaussianBlur(6)), im)
        self.notes = [{'img': glyph(c), 'home': (self.home[0] + dx * W, self.home[1] + dy * H), 'phase': rng.uniform(0, 6.3)}
                      for c, dx, dy in [('♪', -0.13, -0.06), ('♫', 0.11, -0.10), ('♩', -0.07, 0.09), ('♬', 0.14, 0.07), ('♪', 0.02, -0.16), ('♫', -0.16, 0.04)]]
        self.sparks = [{'angle': rng.uniform(0, 2 * math.pi), 'speed': rng.uniform(0.15, 0.55) * H, 'size': rng.uniform(1.5, 4.5) * H / 720, 'life': rng.uniform(0.5, 1.2)} for _ in range(160)]
        ys, xs = np.mgrid[0:H, 0:W]
        d = np.sqrt(((xs - W / 2) / W) ** 2 + ((ys - H * 0.42) / H) ** 2)
        self.background = Image.fromarray((np.array([10, 8, 14]) + np.clip(1 - d * 1.6, 0, 1)[..., None] * np.array([46, 30, 18])).astype(np.uint8)).convert('RGBA')
        # The words beneath: Tamil in gold, then the English in small spaced capitals.
        below = self.origin[1] + self.size[1] + H * 0.015
        self.words = []
        if tamil:
            tamil_font = ImageFont.truetype(str(TAMIL_FONT), round(H * 0.05), layout_engine=ImageFont.Layout.RAQM)
            box = tamil_font.getbbox(tamil)
            self.words.append((tamil, tamil_font, ((W - (box[2] - box[0])) / 2 - box[0], below), GOLD))
            below += (box[3] - box[1]) + H * 0.03
        if english:
            caps = _font(CAPS_FONTS, round(H * 0.03))
            spaced = ' '.join(english.upper())
            box = caps.getbbox(spaced)
            self.words.append((spaced, caps, ((W - (box[2] - box[0])) / 2 - box[0], below), (230, 214, 180)))

    def _paste(self, frame, sprite, centre, alpha=1.0, angle=0.0, zoom=1.0):
        if alpha <= 0.01:
            return
        im = sprite
        if zoom != 1.0:
            im = im.resize((max(1, round(im.width * zoom)), max(1, round(im.height * zoom))), self.Image.LANCZOS)
        if angle:
            im = im.rotate(angle, resample=self.Image.BICUBIC, expand=True)
        if alpha < 1:
            a = np.array(im); a[..., 3] = (a[..., 3] * alpha).astype(np.uint8); im = self.Image.fromarray(a)
        frame.alpha_composite(im, (round(centre[0] - im.width / 2), round(centre[1] - im.height / 2)))

    def frame(self, t: float) -> np.ndarray:
        W, H, home = self.W, self.H, self.home
        frame = self.background.copy()
        glow = self.Image.new('RGBA', (W, H), (0, 0, 0, 0))
        draw = self.ImageDraw.Draw(glow)
        pull = _ease((t - HIT) / (MERGED - HIT))
        for note in self.notes:  # Fade in, bob, then are drawn into the leaf as it strikes.
            bob = math.sin(t * 2.2 + note['phase']) * H * 0.012
            cx = note['home'][0] + (home[0] - note['home'][0]) * pull
            cy = note['home'][1] + bob + (home[1] - note['home'][1]) * pull
            self._paste(frame, note['img'], (cx, cy), alpha=_ease((t - 0.2) / 0.6) * (1 - pull), zoom=1 - 0.6 * pull, angle=math.sin(t * 1.7 + note['phase']) * 8)
        fall = _ease(t / HIT)  # The leaf falls swaying and turning, and lands in its place just as it strikes.
        lx = home[0] + W * 0.12 * (1 - fall) + math.sin(t * 3.1) * W * 0.05 * (1 - fall)
        ly = -H * 0.25 + (home[1] + H * 0.25) * fall
        reveal = _ease((t - HIT - 0.1) / (MERGED - HIT + 0.1))
        angle, zoom = (1 - fall) * 70 * math.sin(t * 2.0), 0.75 + 0.25 * fall
        self._paste(frame, self.plain, (lx, ly), alpha=1 - reveal, angle=angle, zoom=zoom)
        self._paste(frame, self.leaf, (lx, ly), alpha=reveal, angle=angle, zoom=zoom)
        since = t - HIT
        if 0 <= since < 1.3:  # The strike: soft light, a ring and sparks.
            ring = since / 1.3
            r = H * (0.05 + 0.45 * ring)
            draw.ellipse((home[0] - r, home[1] - r, home[0] + r, home[1] + r), outline=GOLD + (round(150 * (1 - ring)),), width=round(4 * H / 720 * (1 - ring)) + 1)
            flash = max(0.0, 1 - since / 0.5)
            if flash:
                bloom = self.Image.new('RGBA', (W, H), (0, 0, 0, 0))
                f = H * 0.12
                self.ImageDraw.Draw(bloom).ellipse((home[0] - f, home[1] - f, home[0] + f, home[1] + f), fill=(255, 214, 140, round(200 * flash)))
                frame.alpha_composite(bloom.filter(self.ImageFilter.GaussianBlur(H * 0.08)))
            for spark in self.sparks:
                if since > spark['life']:
                    continue
                d = spark['speed'] * since * (1 - since / (2 * spark['life']))
                sx, sy = home[0] + math.cos(spark['angle']) * d, home[1] + math.sin(spark['angle']) * d + 0.25 * H * since ** 2
                s = spark['size'] * (1 - since / spark['life'])
                draw.ellipse((sx - s, sy - s, sx + s, sy + s), fill=(255, 220, 140, round(255 * (1 - since / spark['life']))))
        frame.alpha_composite(glow.filter(self.ImageFilter.GaussianBlur(6 * H / 720)))
        frame.alpha_composite(glow)
        grow = _ease((t - WORDS) / 0.8)  # The lettering grows out from the middle.
        if grow > 0:
            a = self.rest.copy()
            xs = np.arange(a.shape[1])[None, :]
            a[..., 3] = (a[..., 3] * np.clip((grow * a.shape[1] * 0.6 - np.abs(xs - a.shape[1] / 2)) / 60, 0, 1)).astype(np.uint8)
            frame.alpha_composite(self.Image.fromarray(a), self.origin)
        for index, (text, font, (wx, wy), colour) in enumerate(self.words):
            p = _ease((t - PRESENTS - 0.25 * index) / 0.7)
            if p > 0:
                layer = self.Image.new('RGBA', (W, H), (0, 0, 0, 0))
                self.ImageDraw.Draw(layer).text((wx, wy + (1 - p) * H * 0.02), text, font=font, fill=colour + (round(255 * p),))
                frame.alpha_composite(layer)
        out = np.array(frame.convert('RGB'))
        return (out * (1 - _ease((t - FADE) / (SECONDS - FADE)))).astype(np.uint8)


def make(logo: Path, width: int = 1920, height: int = 1080, tamil: str = DEFAULT_TAMIL, english: str = DEFAULT_ENGLISH,
         on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The brand intro as an MP4 (`width` x `height`, 5.5 s, silent). Made once for each logo, size and words."""
    target = intro_path(logo, width, height, tamil, english)
    if target.is_file():
        return target
    intro = Intro(logo, width, height, tamil, english)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    writer = subprocess.Popen([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(FPS), '-i', '-',
                               '-c:v', 'libx264', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE)
    frames = round(SECONDS * FPS)
    try:
        assert writer.stdin is not None
        for index in range(frames):
            if should_cancel():
                raise JobCancelled()
            writer.stdin.write(intro.frame(index / FPS).tobytes())
            on_progress(min(99, (index + 1) * 100 // frames))
        writer.stdin.close()
        if writer.wait():
            raise RuntimeError('Could not make the brand intro.')
        temporary.replace(target)
    finally:
        if writer.poll() is None:
            writer.kill()
        temporary.unlink(missing_ok=True)
    return target
