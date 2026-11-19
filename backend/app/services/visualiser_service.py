"""Music visualiser: the song drawn as light that moves with it (bars, a ring, or a wave), on black, as a video to lay
over the picture with the Screen blend. Being an ordinary clip, it plays in the preview and exports the same on the GPU
and through FFmpeg. Bass sits on the left of the bars and the top of the ring."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from app.core.config import settings
from app.services.job_service import JobCancelled

VERSION = 1
FPS = 30
RATE = 22050
WINDOW = 2048
BANDS = 48
LONG_SIDE = 1920  # Drawing is cheap, so it is made sharp; encoding sets the pace.
STYLES = ('bars', 'circle', 'wave')
RISE, FALL = 0.65, 0.12  # How fast a band follows the music up, and settles back down, each frame.


def hex_colour(value: str) -> np.ndarray:
    value = value.strip().lstrip('#')
    if len(value) != 6 or any(ch not in '0123456789abcdefABCDEF' for ch in value):
        raise ValueError('Pick a colour like #7dd3fc.')
    return np.array([int(value[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255


def size_for(width: int, height: int) -> tuple[int, int]:
    scale = min(1, LONG_SIDE / max(width, height))
    return round(width * scale / 2) * 2, round(height * scale / 2) * 2


def read_audio(path: Path, start: float, seconds: float) -> np.ndarray:
    made = subprocess.run([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-ss', f'{max(0.0, start):.3f}', '-t', f'{seconds:.3f}', '-i', str(path),
                           '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True)
    if made.returncode != 0:
        raise ValueError('Could not read the song.')
    return np.frombuffer(made.stdout, dtype=np.float32)


def levels(samples: np.ndarray, frames: int) -> np.ndarray:
    """frames × BANDS levels in 0..1: log-spaced bands from 40 Hz to 12 kHz, loud parts near 1, smoothed like a meter."""
    edges = np.geomspace(40, 12000, BANDS + 1)
    bins = np.fft.rfftfreq(WINDOW, 1 / RATE)
    weights = np.zeros((bins.size, BANDS), np.float32)
    for band in range(BANDS):
        inside = np.flatnonzero((bins >= edges[band]) & (bins < edges[band + 1]))
        if not inside.size:  # Narrower than one bin: the nearest bin stands in.
            inside = [int(np.argmin(np.abs(bins - np.sqrt(edges[band] * edges[band + 1]))))]
        weights[inside, band] = 1 / len(inside)
    window = np.hanning(WINDOW).astype(np.float32)
    padded = np.concatenate([np.zeros(WINDOW // 2, np.float32), samples, np.zeros(WINDOW, np.float32)])
    starts = (np.arange(frames) / FPS * RATE).astype(np.int64)
    raw = np.zeros((frames, BANDS), np.float32)
    for first in range(0, frames, 512):
        chunk = starts[first:first + 512]
        windows = padded[chunk[:, None] + np.arange(WINDOW)[None, :]] * window
        raw[first:first + chunk.size] = np.abs(np.fft.rfft(windows, axis=1)).astype(np.float32) @ weights
    decibels = 20 * np.log10(raw + 1e-7)
    # Each band against its own loud level, so the treble moves as much as the bass.
    top = np.percentile(decibels, 99, axis=0) if frames else np.zeros(BANDS)
    shaped = np.clip((decibels - (top - 36)) / 36, 0, 1) ** 2.2
    smooth = np.zeros_like(shaped)
    current = np.zeros(BANDS, np.float32)
    for n in range(frames):
        current += (shaped[n] - current) * np.where(shaped[n] > current, RISE, FALL)
        smooth[n] = current
    return smooth


def painter(style: str, size: tuple[int, int], colour: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    width, height = size
    unit = min(width, height)
    glow_size = max(3, unit // 40) | 1
    bright = np.minimum(1, colour * 0.55 + 0.45)  # The tips run towards white.

    def finish(core: np.ndarray, peak: np.ndarray) -> np.ndarray:
        small = cv2.resize(core, (width // 4, height // 4), interpolation=cv2.INTER_AREA)  # Glow is soft: blur it small.
        glow = cv2.resize(cv2.GaussianBlur(small, (0, 0), glow_size / 4), (width, height), interpolation=cv2.INTER_LINEAR)
        lum = cv2.addWeighted(core, 1, glow, 1.4, 0)
        channels = [cv2.convertScaleAbs(cv2.addWeighted(lum, float(colour[c]), peak, float(bright[c] - colour[c]), 0), alpha=255) for c in range(3)]
        return cv2.merge(channels)  # uint8 RGB.

    def bars(level: np.ndarray) -> np.ndarray:
        core = np.zeros((height, width), np.float32); peak = np.zeros_like(core)
        span = width * 0.8; left = width * 0.1; step = span / BANDS; thick = max(2, int(step * 0.55))
        base = int(height * 0.9)
        for band, value in enumerate(level):
            x = int(left + step * (band + 0.5)); top = int(base - (0.02 + value * 0.3) * height)
            cv2.line(core, (x, base), (x, top), 0.85, thick, cv2.LINE_AA)
            cv2.line(peak, (x, top), (x, top), float(value), thick, cv2.LINE_AA)
            cv2.line(core, (x, base + 3), (x, base + 3 + int((base - top) * 0.25)), 0.18, thick, cv2.LINE_AA)  # A faint reflection.
        return finish(core, peak)

    def circle(level: np.ndarray) -> np.ndarray:
        core = np.zeros((height, width), np.float32); peak = np.zeros_like(core)
        cx, cy, radius = width / 2, height / 2, unit * 0.2
        mirrored = np.concatenate([level, level[::-1]])  # Symmetric: bass at the top, meeting again at the bottom.
        thick = max(2, int(2 * np.pi * radius / mirrored.size * 0.5))
        for index, value in enumerate(mirrored):
            angle = -np.pi / 2 + 2 * np.pi * index / mirrored.size
            inner, outer = radius, radius + (0.015 + value * 0.17) * unit
            a = (int(cx + np.cos(angle) * inner), int(cy + np.sin(angle) * inner)); b = (int(cx + np.cos(angle) * outer), int(cy + np.sin(angle) * outer))
            cv2.line(core, a, b, 0.85, thick, cv2.LINE_AA)
            cv2.line(peak, b, b, float(value), thick, cv2.LINE_AA)
        cv2.circle(core, (int(cx), int(cy)), int(radius - thick), 0.35, max(1, thick // 2), cv2.LINE_AA)
        return finish(core, peak)

    xs = np.linspace(width * 0.06, width * 0.94, 160)
    def wave(level: np.ndarray) -> np.ndarray:
        core = np.zeros((height, width), np.float32); peak = np.zeros_like(core)
        shape = np.interp(np.linspace(0, BANDS - 1, xs.size), np.arange(BANDS), level)
        fade = np.sin(np.linspace(0, np.pi, xs.size)) ** 0.7  # Calm at both ends.
        middle = height * 0.5
        for sign, strength in ((1, 0.9), (-1, 0.45)):
            ys = middle - sign * shape * fade * height * 0.22
            points = np.stack([xs, ys], 1).astype(np.int32)
            cv2.polylines(core, [points], False, strength, max(2, unit // 160), cv2.LINE_AA)
        top = np.stack([xs, middle - shape * fade * height * 0.22], 1).astype(np.int32)
        cv2.polylines(peak, [top], False, 0.6, max(2, unit // 160), cv2.LINE_AA)
        return finish(core, peak)

    return {'bars': bars, 'circle': circle, 'wave': wave}[style]


def video_path(song: Path, start: float, seconds: float, style: str, colour: str, size: tuple[int, int]) -> Path:
    ident = json.dumps([VERSION, str(song), song.stat().st_size, round(start, 2), round(seconds, 2), style, colour.lower(), size])
    return settings.data_dir / 'media' / f'visualiser-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def make(song: Path, start: float, seconds: float, style: str, colour: str, frame: tuple[int, int],
         on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The visualiser for `seconds` of the song from `start`, in the project's shape."""
    if style not in STYLES:
        raise ValueError('Choose bars, circle or wave.')
    tint = hex_colour(colour)
    size = size_for(*frame)
    target = video_path(song, start, seconds, style, colour, size)
    if target.is_file():
        return target
    frames = max(2, round(seconds * FPS))
    on_progress(2)
    moving = levels(read_audio(song, start, seconds), frames)
    on_progress(15)
    draw = painter(style, size, tint)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{size[0]}x{size[1]}', '-r', str(FPS),
                                '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE)
    try:
        assert process.stdin is not None
        for n in range(frames):
            if should_cancel():
                raise JobCancelled()
            process.stdin.write(draw(moving[n]).tobytes())
            if n % 30 == 0:
                on_progress(15 + 83 * n // frames)
        process.stdin.close()
        if process.wait():
            raise RuntimeError('Could not make the visualiser.')
        temporary.replace(target)
    finally:
        if process.poll() is None:
            process.kill()
        temporary.unlink(missing_ok=True)
    on_progress(100)
    return target
