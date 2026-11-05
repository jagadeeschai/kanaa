"""Draws a travel route map as a short video: the camera starts on the first place, pulls back to show the way,
a plane (or car, train or boat) travels along it drawing the line behind, pins drop with names, and the camera
settles on the destination. Drawn on this Mac from the downloaded outlines (travel_map_service.py), like the effects.
"""
from __future__ import annotations

import math
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.services import travel_map_service as maps
from app.services.job_service import JobCancelled

FPS = 30
SHORT_SIDE = 720
SUPERSAMPLE = 2
FONTS = Path(__file__).resolve().parent.parent / 'assets' / 'fonts'
INTRO, LEG, OUTRO, MOVE = 0.8, 3.6, 1.6, 0.9  # Seconds.
TIGHT_SPAN = 2.4 / 360  # World units across the short side when close on a place (about 260 km).

STYLES = {
    'light': {'sea': '#a8cde0', 'land': '#f3eee2', 'border': '#a89c86', 'state': '#d3c8b3', 'river': '#8fc0d8', 'route': '#e4543c', 'ahead': '#e4543c55', 'text': '#1f1f1f', 'chip': '#ffffffee', 'grain': 0},
    'dark': {'sea': '#0d1a26', 'land': '#223241', 'border': '#4f6377', 'state': '#33475b', 'river': '#1c3d57', 'route': '#ffb547', 'ahead': '#ffb54755', 'text': '#ffffff', 'chip': '#0d1a26e6', 'grain': 0},
    'vintage': {'sea': '#c6d6c2', 'land': '#ecdcb6', 'border': '#8a6d45', 'state': '#bfa479', 'river': '#a3bfb1', 'route': '#a8352a', 'ahead': '#a8352a55', 'text': '#3a2918', 'chip': '#f6ecd5ee', 'grain': 10},
}
MODES = ('flight', 'car', 'train', 'boat')


@dataclass
class Camera:
    x: float
    y: float
    span: float  # World units across the short side.


def work_size(width: int, height: int) -> tuple[int, int]:
    scale = SHORT_SIDE / min(width, height)
    return max(2, round(width * scale / 2) * 2), max(2, round(height * scale / 2) * 2)


def world(points: list[list[float]]) -> np.ndarray:
    array = np.asarray(points, dtype=np.float64)
    x, y = maps.mercator(array[:, 0], array[:, 1])
    return np.stack([x, y], axis=1)


def fit(points: np.ndarray, aspect: float) -> Camera:
    """A camera that shows all the points with room around them."""
    x0, y0 = points.min(axis=0); x1, y1 = points.max(axis=0)
    width, height = (x1 - x0) * 1.5, (y1 - y0) * 1.5
    # `span` is what the short side shows: in a wide frame that is the height, in a tall one the width.
    span = max(height, width / aspect) if aspect >= 1 else max(width, height * aspect)
    span = max(span, TIGHT_SPAN * 1.4)
    return Camera(float((x0 + x1) / 2), float((y0 + y1) / 2), float(min(span, 0.9)))


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def between(a: Camera, b: Camera, t: float) -> Camera:
    """Glides from one view to another, zooming evenly (by the logarithm of the span)."""
    t = ease(t)
    return Camera(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, math.exp(math.log(a.span) + (math.log(b.span) - math.log(a.span)) * t))


def plan(stops: list[np.ndarray], paths: list[np.ndarray], aspect: float) -> tuple[list[tuple[float, Camera]], list[tuple[float, float]], float]:
    """Camera keys [(time, camera)], each leg's (start, end) travel times, and the total length."""
    tight = lambda point: Camera(float(point[0]), float(point[1]), TIGHT_SPAN)
    keys = [(0.0, tight(stops[0])), (INTRO, tight(stops[0]))]
    legs = []
    t = INTRO
    for path in paths:
        view = fit(path, aspect)
        keys.append((t + MOVE, view))
        legs.append((t + MOVE * 0.6, t + MOVE + LEG - MOVE * 0.3))
        t += MOVE + LEG
        keys.append((t, view))
    keys.append((t + MOVE, tight(stops[-1])))
    total = t + MOVE + OUTRO
    keys.append((total, tight(stops[-1])))
    return keys, legs, total


def camera_at(keys: list[tuple[float, Camera]], t: float) -> Camera:
    for (t0, a), (t1, b) in zip(keys, keys[1:]):
        if t <= t1:
            return between(a, b, (t - t0) / (t1 - t0) if t1 > t0 else 1.0)
    return keys[-1][1]


class Painter:
    def __init__(self, size: tuple[int, int], style: str):
        self.width, self.height = size[0] * SUPERSAMPLE, size[1] * SUPERSAMPLE
        self.colours = STYLES[style]
        self.layers = maps.load_layers()
        unit = min(self.width, self.height)
        self.latin = ImageFont.truetype(str(FONTS / 'NotoSans-Bold.ttf'), round(unit * 0.042))
        self.tamil = ImageFont.truetype(str(FONTS / 'NotoSansTamil-Bold.ttf'), round(unit * 0.040), layout_engine=ImageFont.Layout.RAQM)
        self.small = ImageFont.truetype(str(FONTS / 'NotoSans-Bold.ttf'), round(unit * 0.018))
        self.grain = None
        if STYLES[style]['grain']:
            rng = np.random.default_rng(5)
            noise = rng.normal(0, STYLES[style]['grain'], (self.height // 2, self.width // 2)).astype(np.float32)
            self.grain = np.asarray(Image.fromarray(np.clip(noise + 128, 0, 255).astype(np.uint8)).resize((self.width, self.height)), np.float32) - 128

    def scale(self, camera: Camera) -> float:
        return min(self.width, self.height) / camera.span

    def pixels(self, points: np.ndarray, camera: Camera) -> np.ndarray:
        s = self.scale(camera)
        return np.stack([(points[:, 0] - camera.x) * s + self.width / 2, (points[:, 1] - camera.y) * s + self.height / 2], axis=1)

    def _shapes(self, draw: ImageDraw.ImageDraw, rings, camera: Camera, fill=None, outline=None, width=1, line=False, smallest=1.5) -> None:
        s = self.scale(camera)
        half_w, half_h = self.width / 2 / s, self.height / 2 / s
        x0, x1, y0, y1 = camera.x - half_w, camera.x + half_w, camera.y - half_h, camera.y + half_h
        for points, (bx0, by0, bx1, by1) in rings:
            if bx1 < x0 or bx0 > x1 or by1 < y0 or by0 > y1 or max(bx1 - bx0, by1 - by0) * s < smallest:
                continue
            pixels = self.pixels(points, camera).round().astype(np.int32)
            keep = np.ones(len(pixels), dtype=bool)
            keep[1:] = np.any(np.diff(pixels, axis=0) != 0, axis=1)
            flat = [tuple(point) for point in pixels[keep]]
            if len(flat) < 2:
                continue
            if line:
                draw.line(flat, fill=outline, width=width, joint='curve')
            elif len(flat) >= 3:
                draw.polygon(flat, fill=fill, outline=outline, width=width)

    def label(self, image: Image.Image, draw: ImageDraw.ImageDraw, text: str, at: tuple[float, float], appear: float) -> None:
        """A name in a rounded chip above a pin, fading and rising in as `appear` goes 0 → 1."""
        if appear <= 0:
            return
        parts = [(part, self.tamil if maps.TAMIL.search(part) else self.latin) for part in text.split(' · ')]
        gap = round(self.latin.size * 0.5)
        sizes = [draw.textbbox((0, 0), part, font=font) for part, font in parts]
        width = sum(box[2] - box[0] for box in sizes) + gap * (len(parts) - 1)
        height = max(box[3] - box[1] for box in sizes)
        pad = round(height * 0.45)
        x = min(max(at[0] - width / 2, pad), self.width - width - pad)
        y = at[1] - height - pad * 3 - (1 - appear) * pad * 2
        alpha = round(255 * min(1.0, appear))
        chip = Image.new('RGBA', (self.width, self.height))
        chip_draw = ImageDraw.Draw(chip)
        background = self.colours['chip']
        colour = tuple(int(background[index:index + 2], 16) for index in (1, 3, 5)) + (int(int(background[7:9], 16) * appear),)
        chip_draw.rounded_rectangle([x - pad, y - pad * 0.7, x + width + pad, y + height + pad * 0.9], radius=pad, fill=colour)
        cursor = x
        text_colour = self.colours['text']
        for (part, font), box in zip(parts, sizes):
            chip_draw.text((cursor - box[0], y - box[1]), part, font=font, fill=text_colour + format(alpha, '02x'))
            cursor += box[2] - box[0] + gap
        image.alpha_composite(chip)

    def vehicle(self, draw: ImageDraw.ImageDraw, mode: str, at: np.ndarray, heading: float) -> None:
        unit = min(self.width, self.height) * 0.028
        shapes = {
            'flight': [(1.2, 0), (0.3, 0.15), (0.1, 0.9), (-0.15, 0.9), (-0.05, 0.15), (-0.75, 0.12), (-0.95, 0.45), (-1.1, 0.45), (-0.95, 0), (-1.1, -0.45), (-0.95, -0.45), (-0.75, -0.12), (-0.05, -0.15), (-0.15, -0.9), (0.1, -0.9), (0.3, -0.15)],
            'car': [(0.9, 0.45), (-0.9, 0.45), (-0.9, -0.45), (0.9, -0.45)],
            'train': [(1.1, 0.4), (-1.1, 0.4), (-1.1, -0.4), (1.1, -0.4)],
            'boat': [(1.0, 0), (0.5, 0.45), (-0.9, 0.45), (-0.9, -0.45), (0.5, -0.45)],
        }[mode]
        c, s = math.cos(heading), math.sin(heading)
        points = [(at[0] + (px * c - py * s) * unit, at[1] + (px * s + py * c) * unit) for px, py in shapes]
        draw.polygon(points, fill=self.colours['route'], outline='#ffffff', width=max(2, round(unit * 0.15)))

    def pin(self, draw: ImageDraw.ImageDraw, at: np.ndarray, appear: float) -> None:
        if appear <= 0:
            return
        r = min(self.width, self.height) * 0.012 * (0.6 + 0.4 * min(1.0, appear))
        draw.ellipse([at[0] - r * 1.8, at[1] - r * 1.8, at[0] + r * 1.8, at[1] + r * 1.8], fill=self.colours['route'] + '44')
        draw.ellipse([at[0] - r, at[1] - r, at[0] + r, at[1] + r], fill=self.colours['route'], outline='#ffffff', width=max(2, round(r * 0.35)))

    def frame(self, camera: Camera, stops: list[np.ndarray], labels: list[str], paths: list[np.ndarray], modes: list[str], progress: list[float], pins: list[float], credit: str) -> Image.Image:
        image = Image.new('RGBA', (self.width, self.height), self.colours['sea'])
        draw = ImageDraw.Draw(image, 'RGBA')  # Blends see-through colours, like the faint line still to travel.
        unit = min(self.width, self.height)
        self._shapes(draw, self.layers['land'], camera, fill=self.colours['land'])
        zoomed_in = camera.span < 0.08
        if zoomed_in:
            self._shapes(draw, self.layers['states'], camera, outline=self.colours['state'], width=max(1, round(unit * 0.0016)), line=True)
            self._shapes(draw, self.layers['rivers'], camera, outline=self.colours['river'], width=max(1, round(unit * 0.0018)), line=True, smallest=6)
        self._shapes(draw, self.layers['lakes'], camera, fill=self.colours['sea'])
        self._shapes(draw, self.layers['land'], camera, outline=self.colours['border'], width=max(1, round(unit * 0.0022)), line=True)
        thick = max(3, round(unit * 0.008))
        for path, mode, done in zip(paths, modes, progress):
            pixels = self.pixels(path, camera)
            whole = [tuple(point) for point in pixels]
            draw.line(whole, fill=self.colours['ahead'], width=max(2, thick // 2), joint='curve')
            if done <= 0:
                continue
            lengths = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pixels, axis=0).T))])
            reach = lengths[-1] * done
            count = int(np.searchsorted(lengths, reach))
            head = pixels[min(count, len(pixels) - 1)]
            if 0 < count < len(pixels):
                f = (reach - lengths[count - 1]) / max(1e-6, lengths[count] - lengths[count - 1])
                head = pixels[count - 1] + (pixels[count] - pixels[count - 1]) * f
            travelled = [tuple(point) for point in pixels[:count]] + [tuple(head)]
            if len(travelled) >= 2:
                if mode == 'flight':  # Dashed, like a flight path.
                    dash = unit * 0.02
                    walked = 0.0
                    for a, b in zip(travelled, travelled[1:]):
                        segment = math.dist(a, b)
                        if int(walked // dash) % 2 == 0:
                            draw.line([a, b], fill=self.colours['route'], width=thick)
                        walked += segment
                else:
                    draw.line(travelled, fill=self.colours['route'], width=thick, joint='curve')
            if done < 1:
                behind = travelled[-2] if len(travelled) >= 2 else tuple(pixels[0])
                heading = math.atan2(head[1] - behind[1], head[0] - behind[0])
                self.vehicle(draw, mode, head, heading)
        for stop, label, appear in zip(stops, labels, pins):
            at = self.pixels(stop[None, :], camera)[0]
            self.pin(draw, at, appear)
            self.label(image, draw, label, (at[0], at[1]), appear)
        draw.text((self.width - unit * 0.02, self.height - unit * 0.02), credit, font=self.small, fill=self.colours['text'] + '99', anchor='rd')
        if self.grain is not None:
            rgb = np.asarray(image.convert('RGB'), np.float32) + self.grain[..., None]
            image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert('RGBA')
        return image.convert('RGB').resize((self.width // SUPERSAMPLE, self.height // SUPERSAMPLE), Image.LANCZOS)


def render(stops: list[dict], modes: list[str], size: tuple[int, int], style: str, language: str, target: Path,
           on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> dict:
    """Draws the route map video. `stops` are places ({name, tamil, lat, lon}); `modes` one per leg."""
    if len(stops) < 2 or len(modes) != len(stops) - 1 or any(mode not in MODES for mode in modes) or style not in STYLES:
        raise ValueError('Choose at least two places, and how each part of the trip is travelled.')
    routes = [maps.route((a['lon'], a['lat']), (b['lon'], b['lat']), mode) for a, b, mode in zip(stops, stops[1:], modes)]
    paths = [world(points) for points, _ in routes]
    points = [world([[stop['lon'], stop['lat']]])[0] for stop in stops]
    width, height = work_size(*size)
    keys, legs, total = plan(points, paths, width / height)
    painter = Painter((width, height), style)
    labels = [maps.place_label(stop, language) for stop in stops]
    roads = any(real for _, real in routes)
    credit = 'Natural Earth · GeoNames' + (' · © OpenStreetMap contributors' if roads else '')
    frames = round(total * FPS)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix('.part.mp4')
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(FPS), '-i', '-',
                                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(partial)], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        assert process.stdin is not None
        for n in range(frames):
            if should_cancel():
                raise JobCancelled()
            t = n / FPS
            progress = [ease((t - start) / (end - start)) for start, end in legs]
            # A place's pin drops when the trip reaches it; the first is there from the start.
            pins = [min(1.0, t / 0.4)] + [min(1.0, max(0.0, (t - end) / 0.4)) for _, end in legs]
            frame = painter.frame(camera_at(keys, t), points, labels, paths, modes, progress, pins, credit)
            process.stdin.write(frame.tobytes())
            on_progress(min(95, (n + 1) * 95 // frames))
        process.stdin.close()
        if process.wait(timeout=180):
            raise RuntimeError('Could not make the travel map.')
    except BaseException:
        process.kill()
        partial.unlink(missing_ok=True)
        raise
    partial.replace(target)
    return {'seconds': round(frames / FPS, 2), 'roads': roads, 'fallback': [mode != 'flight' and mode != 'boat' and not real for (_, real), mode in zip(routes, modes)]}
