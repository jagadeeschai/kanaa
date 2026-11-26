"""Film physics, two looks that make digital footage feel shot on film with a real camera operator:

- Halation: the warm red-orange glow film stock gives around bright highlights (light scatters back through the film
  base). The brightest parts of each frame are picked out, spread into a soft glow, tinted warm and laid back over
  the picture as light (screen, so it brightens and never clips).
- Handheld shake: a believable human camera wobble, from a smooth organic motion (sines at a few unrelated speeds, the
  same every time for the same part of the same footage, whatever other looks it has), never random jitter. The picture is zoomed in just enough that the moving edges
  never show.

Both are new videos of the clip's part (with its sound); the original is kept to go back to. Drawn on this Mac's GPU
(native/film_render.swift, Core Image) with the hardware encoder when it can; otherwise on the CPU here, the same way
(tests/test_film.py compares the two).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import shutil
import struct
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.cutout_service import colour
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

logger = logging.getLogger(__name__)
VERSION = 4  # 2: shake zooms by the frame's shape, so no edge ever shows. 3: shake seeded by the original part. 4: on-the-beat shake.
GPU_TOOL = Path(__file__).resolve().parents[2] / 'native' / 'film_render.swift'
TINT = (1.0, 0.42, 0.18)  # Halation's colour (R, G, B): the warm red-orange of film.
HALATION = {
    'subtle': {'strength': 0.35, 'threshold': 0.78, 'spread': 0.012},
    'classic': {'strength': 0.6, 'threshold': 0.7, 'spread': 0.018},
    'dreamy': {'strength': 0.9, 'threshold': 0.6, 'spread': 0.03},
}
# Handheld: how far it wanders (share of the width), how much it turns (degrees), the speeds it moves at (a second), and
# for impact, how quickly the jolt settles (seconds; 0 never).
SHAKE = {
    'docu': {'amount': 1.0, 'speed': 1.0, 'reach': 0.006, 'turn': 0.25, 'speeds': (0.7, 1.3, 2.9), 'settle': 0.0},
    'float': {'amount': 1.0, 'speed': 1.0, 'reach': 0.012, 'turn': 0.45, 'speeds': (0.13, 0.27, 0.41), 'settle': 0.0},
    'impact': {'amount': 1.0, 'speed': 1.0, 'reach': 0.025, 'turn': 0.8, 'speeds': (6.0, 9.0, 13.0), 'settle': 0.35},
    # On the beat: a short jolt on each of the song's beats (`hits`), settling between them.
    'beat': {'amount': 1.0, 'speed': 1.0, 'reach': 0.018, 'turn': 0.6, 'speeds': (7.0, 11.0, 15.0), 'settle': 0.18},
}
WEAVE = {
    'subtle': {'amount': 1.0, 'speed': 1.0, 'reach': 0.002, 'turn': 0.05, 'speeds': (0.18, 0.37, 0.61), 'settle': 0.0},
    'classic': {'amount': 1.0, 'speed': 1.0, 'reach': 0.004, 'turn': 0.1, 'speeds': (0.22, 0.43, 0.71), 'settle': 0.0},
    'worn': {'amount': 1.0, 'speed': 1.0, 'reach': 0.008, 'turn': 0.2, 'speeds': (0.25, 0.52, 0.89), 'settle': 0.0},
}
BREATHING = {
    'subtle': {'amount': 0.015, 'speed': 0.25},
    'classic': {'amount': 0.03, 'speed': 0.35},
    'deep': {'amount': 0.06, 'speed': 0.45},
}


def target_path(source: Path, start: float, end: float, kind: str, preset: str, tune: dict | None = None, seed: int | None = None,
                hits: list[float] | None = None) -> Path:
    from app.services.look_tune import key
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), kind, preset] + ([key(tune)] if tune else []) + ([seed] if seed is not None else []) + ([[round(hit, 3) for hit in hits]] if hits is not None else []))
    return settings.data_dir / 'media' / f'{kind}-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def halation_frame(frame: np.ndarray, chosen: dict) -> np.ndarray:
    """One frame with halation (CPU). frame: H×W×3 BGR uint8."""
    import cv2
    height, width = frame.shape[:2]
    picture = frame.astype(np.float32) / 255
    luma = picture @ np.array([0.114, 0.587, 0.299], np.float32)
    threshold = chosen['threshold']
    t = np.clip((luma - threshold) / max(1e-3, 1 - threshold), 0, 1)
    source = picture * (t * t * (3 - 2 * t) * luma)[..., None]  # Only the brightest parts give off a glow.
    half = (max(8, width // 2), max(8, height // 2))
    glow = cv2.resize(cv2.GaussianBlur(cv2.resize(source, half, interpolation=cv2.INTER_AREA), (0, 0), max(0.5, chosen['spread'] * height / 2)),
                      (width, height), interpolation=cv2.INTER_LINEAR)
    light = glow.mean(axis=2, keepdims=True) * np.array(TINT[::-1], np.float32) * chosen['strength'] * 2.5
    return (np.clip(1 - (1 - picture) * (1 - np.clip(light, 0, 1)), 0, 1) * 255 + 0.5).astype(np.uint8)


def jolt(t: float, settle: float, hits: list[float] | None) -> float:
    """How much of the shake is left at `t`: one jolt from the start, or (with `hits`) a fresh one at each hit, each
    settling over `settle` seconds; 1 throughout when it never settles."""
    if not settle:
        return 1.0
    if hits is None:
        return math.exp(-t / settle)
    last = max((hit for hit in hits if hit <= t), default=None)
    return 0.0 if last is None else math.exp(-(t - last) / settle)


def shake_path(chosen: dict, frames: int, fps: float, seed: int, aspect: float = 9 / 16, hits: list[float] | None = None) -> list[tuple[float, float, float, float]]:
    """The camera at each frame: (across, down) as shares of the width, a turn in degrees, and the zoom that keeps the
    edges hidden (the same for the whole clip). `aspect` is the frame's height over its width: a wide frame has less room
    up and down, so the same shift needs more zoom there. `hits` (seconds into the part): a jolt at each."""
    rng = np.random.default_rng(seed)
    phases = rng.uniform(0, 2 * math.pi, (3, len(chosen['speeds'])))
    weights = np.array([1.0, 0.55, 0.3][:len(chosen['speeds'])])
    reach, turn = chosen['reach'] * chosen['amount'], chosen['turn'] * chosen['amount']
    out = []
    if hits is not None:  # On the beat: each beat throws the camera to full reach, a new way each time, and it rings out.
        ordered = sorted(hits)
        ways = rng.uniform(0, 2 * math.pi, len(ordered))
        turns = rng.choice([-1.0, 1.0], len(ordered))
        ring = chosen['speeds'][0] * chosen['speed']
        for k in range(frames):
            t = k / fps
            n = next((i for i in range(len(ordered) - 1, -1, -1) if ordered[i] <= t), None)
            if n is None:
                out.append((0.0, 0.0, 0.0))
                continue
            since = t - ordered[n]
            swing = math.exp(-since / chosen['settle']) * math.cos(2 * math.pi * ring * since)
            out.append((reach * math.cos(ways[n]) * swing, reach * 0.8 * math.sin(ways[n]) * swing, turn * turns[n] * swing))
    for k in range(frames if hits is None else 0):
        t = k / fps
        settle = jolt(t, chosen['settle'], hits)
        wave = [float(np.dot(weights, np.sin(2 * math.pi * np.array(chosen['speeds']) * chosen['speed'] * t + phases[axis])) / weights.sum()) for axis in range(3)]
        out.append((reach * wave[0] * settle, reach * 0.8 * wave[1] * settle, turn * wave[2] * settle))
    # Zoomed in just enough to cover the furthest it goes (and a turn's corners), so the edges never show.
    furthest = max((max(abs(a), abs(b) / aspect) for a, b, _ in out), default=0.0)  # Shifts as shares of each side.
    turned = math.sin(math.radians(max((abs(c) for _, _, c in out), default=0.0)))
    zoom = (1 + 2 * furthest) * (1 + turned * (1 / aspect + aspect)) + 0.003  # A turn swings the corners in by both sides.
    return [(a, b, c, zoom) for a, b, c in out]


def breathing_path(chosen: dict, frames: int, fps: float) -> list[tuple[float, float, float, float]]:
    """Slight zoom that follows a slow sine, always >= 1.0 so edges never show."""
    return [(0.0, 0.0, 0.0, 1.0 + chosen['amount'] * 0.5 * (1.0 - math.cos(2 * math.pi * chosen['speed'] * (k / fps)))) for k in range(frames)]


def shake_frame(frame: np.ndarray, camera: tuple[float, float, float, float]) -> np.ndarray:
    """One frame moved by the camera (CPU): shifted, turned and zoomed about the middle."""
    import cv2
    height, width = frame.shape[:2]
    across, down, turn, zoom = camera
    matrix = cv2.getRotationMatrix2D(((width - 1) / 2, (height - 1) / 2), turn, zoom)
    matrix[0, 2] += across * width
    matrix[1, 2] += down * width
    return cv2.warpAffine(frame, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def seed_of(*part) -> int:
    """A shake seed from what a part is (the original footage and its in and out): each cut wobbles its own way."""
    return int(hashlib.sha256(json.dumps([str(each) if not isinstance(each, float) else round(each, 3) for each in part]).encode()).hexdigest()[:8], 16)


def make(facts: MediaFacts, start: float, end: float, kind: str, preset: str, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False, tune: dict | None = None, seed: int | None = None,
         hits: list[float] | None = None) -> Path:
    """The part start..end (source seconds) with a film look (`kind`: halation, shake, weave or breathing). Made once.
    `seed` picks the shake's motion: from the original part (see seed_of), so other looks before it never change it.
    `hits`: for shake on the beat, the beats' times in seconds into the part."""
    table = HALATION if kind == 'halation' else SHAKE if kind == 'shake' else WEAVE if kind == 'weave' else BREATHING if kind == 'breathing' else None
    if table is None or preset not in table:
        raise ValueError('Choose a film look preset.')
    hits = sorted(hits) if hits is not None and kind == 'shake' else None
    target = target_path(facts.path, start, end, kind, preset, tune, seed, hits)
    seed = seed if seed is not None else seed_of(str(facts.path), start, end)
    if target.is_file():
        return target
    chosen = {**table[preset], **(tune or {})}
    if os.environ.get('KANAA_GPU_EFFECTS') != '0':
        try:
            if _make(facts, start, end, kind, chosen, target, on_progress, should_cancel, gpu=True, seed=seed, hits=hits):
                on_progress(100)
                return target
        except JobCancelled:
            raise
        except Exception:
            logger.exception('GPU film look failed; making it on the CPU')
    _make(facts, start, end, kind, chosen, target, on_progress, should_cancel, gpu=False, seed=seed, hits=hits)
    on_progress(100)
    return target


def _make(facts: MediaFacts, start: float, end: float, kind: str, chosen: dict, target: Path, on_progress, should_cancel, gpu: bool, seed: int = 0, hits: list[float] | None = None) -> bool:
    import cv2
    from app.services.lens_service import hardware_encoder
    tool = None
    if gpu:
        from app.services.cutout_service import helper
        try:
            tool = helper(GPU_TOOL)
        except RuntimeError:
            return False
    ffmpeg = shutil.which('ffmpeg')
    width, height = facts.width or 1920, facts.height or 1080
    width, height = width - width % 2, height - height % 2
    fps = facts.fps or 30
    total = max(1, round((end - start) * fps))
    span = ['-ss', f'{start:.3f}', '-t', f'{end - start:.3f}']
    cameras = shake_path(chosen, total + 2, fps, seed=seed, aspect=height / width, hits=hits) if kind in ('shake', 'weave') else breathing_path(chosen, total + 2, fps) if kind == 'breathing' else None
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *span, '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={width}:{height}',
                             '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    processes = [read]
    try:
        encoder = hardware_encoder(ffmpeg, height) if gpu else ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16']
        draw = None
        if gpu:
            values = [chosen['strength'], chosen['threshold'], chosen['spread'], *TINT] if kind == 'halation' else [0.0] * 6
            draw = subprocess.Popen([str(tool), kind, str(width), str(height), *(f'{value}' for value in values)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            processes.append(draw)
        write = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra' if gpu else 'bgr24', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                                  *span, '-i', str(facts.path), '-map', '0:v', '-map', '1:a?', *encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                                  '-shortest', '-movflags', '+faststart', str(temporary)], stdin=draw.stdout if draw else subprocess.PIPE, stderr=subprocess.PIPE)
        processes.append(write)
        if draw:
            draw.stdout.close()
        size, done = width * height * 3, 0
        assert read.stdout
        while chunk := read.stdout.read(size):
            if should_cancel():
                raise JobCancelled()
            if len(chunk) < size:
                break
            frame = np.frombuffer(chunk, np.uint8).reshape(height, width, 3)
            camera = cameras[min(done, len(cameras) - 1)] if cameras else (0.0, 0.0, 0.0, 1.0)
            if draw:
                # Per frame: the camera (four float32s; unused for halation), then the frame.
                draw.stdin.write(struct.pack('<ffff', *camera) + cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA).tobytes())
            else:
                write.stdin.write((halation_frame(frame, chosen) if kind == 'halation' else shake_frame(frame, camera)).tobytes())
            done += 1
            if done % 10 == 0:
                on_progress(min(98, done * 98 // total))
        (draw.stdin if draw else write.stdin).close()
        if (draw and draw.wait()) or write.wait() or done == 0 or not temporary.is_file():
            raise RuntimeError(f'Could not make the film look: {(write.stderr.read() if write.stderr else b"")[-300:]!r}')
        temporary.replace(target)
        return True
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
