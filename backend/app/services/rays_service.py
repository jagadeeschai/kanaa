"""God rays: beams of light streaming from the sun (or the brightest part of the sky) through trees, people and haze.
In each frame the light is found where the sky (the farthest part, from the clip's depth map) is brightest, and
followed smoothly so the beams don't jitter. Only that bright sky gives light; everything solid in front of it (trees,
the hill, the people) blocks it. The light is then streamed outward from its source, fading with distance, which
leaves real shadow streaks behind whatever blocked it, and added over the picture in the preset's colour. The result
is a new video of the clip's part (with its sound), and the original is kept to go back to.

The beams are worked out small (soft light needs no detail). Drawn on this Mac's GPU (native/rays_render.swift,
Core Image) with the hardware encoder when it can; otherwise on the CPU here, with the same formula
(tests/test_god_rays.py compares the two).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import struct
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.cutout_service import colour
from app.services.depth_mask_service import make_depth_map
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

logger = logging.getLogger(__name__)
VERSION = 2  # 2: the light found by colour; streaked haze; soft roll-off.
GPU_TOOL = Path(__file__).resolve().parents[2] / 'native' / 'rays_render.swift'
SMALL = 320  # Width the light is found and the beams worked out at.
STEPS = 48  # Samples along each beam.
GAIN = 5.0  # How bright the gathered light is, before the preset's strength (it then rolls off, never clipping).
SKY_FROM, SKY_TO = 0.02, 0.08  # Nearness: below the first is sky, past the second is land (which blocks the light).
GLOW = 0.1  # How wide the light's own glow is (share of the width).
SKY_SHARE = 0.2  # How much the rest of the bright sky gives light too.
STREAKS = ((5, 0.3, 0.21), (11, 1.7, -0.33), (19, 4.1, 0.37))  # Haze streaks: lobes round the light, phase, drift a second.
FOLLOW = 0.15  # How quickly the light's place follows the bright sky from frame to frame (0..1).
# How far each beam reaches (share of the way to the light), how slowly it fades, how bright, and its colour (R, G, B).
PRESETS = {
    'soft': {'reach': 0.55, 'decay': 0.965, 'strength': 0.55, 'tint': (1.0, 0.92, 0.78)},
    'strong': {'reach': 0.8, 'decay': 0.975, 'strength': 1.0, 'tint': (1.0, 0.9, 0.72)},
    'dusty': {'reach': 0.75, 'decay': 0.972, 'strength': 0.85, 'tint': (1.0, 0.74, 0.45)},
}


def target_path(source: Path, start: float, end: float, preset: str, tune: dict | None = None) -> Path:
    from app.services.look_tune import key
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), preset] + ([key(tune)] if tune else []))
    return settings.data_dir / 'media' / f'rays-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def _sky_and_bright(frame_small: np.ndarray, near_small: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The sky (0..1) and how bright each point of it is against the rest of the sky (0..1), by its brightest colour
    channel, so an orange sun outshines a white haze."""
    import cv2
    sky = np.clip((SKY_TO - near_small) / (SKY_TO - SKY_FROM), 0, 1).astype(np.float32)
    value = cv2.GaussianBlur(frame_small.max(axis=2).astype(np.float32) / 255, (0, 0), 1.5)
    seen = value[sky > 0.5]
    low, high = (float(np.percentile(seen, 50)), float(seen.max())) if seen.size > 50 else (0.5, 1.0)
    return sky, np.clip((value - low) / max(1e-3, high - low), 0, 1)


def find_light(frame_small: np.ndarray, near_small: np.ndarray) -> tuple[float, float] | None:
    """The brightest point of the sky (the sun, or the brightest part of it), as a share of the frame; none without sky."""
    import cv2
    sky = np.clip((SKY_TO - near_small) / (SKY_TO - SKY_FROM), 0, 1)
    # Bright and coloured, unblurred (a low sun is a few points across here): a low sun is about twice as saturated as
    # the equally bright, often overexposed, haze around it.
    hsv = cv2.GaussianBlur(cv2.cvtColor(frame_small, cv2.COLOR_BGR2HSV).astype(np.float32) / 255, (0, 0), 0.7)
    score = hsv[..., 2] * (hsv[..., 1] + 0.15) * (sky > 0.5)
    if not score.any():
        return None
    y, x = np.unravel_index(int(np.argmax(score)), score.shape)
    return (x + 0.5) / score.shape[1], (y + 0.5) / score.shape[0]


def light_mask(frame_small: np.ndarray, near_small: np.ndarray, at: tuple[float, float], when: float = 0.0) -> np.ndarray:
    """What gives light, 0..1: a glow around the light and the brighter sky, only where there is sky (land, trees and
    people block it)."""
    sky, bright = _sky_and_bright(frame_small, near_small)
    height, width = sky.shape
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    far = ((xs + 0.5) / width - at[0]) ** 2 + (((ys + 0.5) / height - at[1]) * height / width) ** 2
    glow = np.exp(-far / (2 * GLOW ** 2))
    # The haze is never even: the light around the source breaks into soft streaks radiating from it, drifting slowly.
    # This is what turns a glow into rays, even in an open sky; trees and people break it further, for real.
    angle = np.arctan2((ys + 0.5) / height - at[1], (xs + 0.5) / width - at[0])
    waves = sum(np.sin(lobes * angle + phase + drift * when) for lobes, phase, drift in STREAKS) / len(STREAKS)
    streaks = np.clip(0.5 + 0.75 * waves, 0, 1) ** 1.5
    return (sky * np.clip(SKY_SHARE * bright + glow, 0, 1) * (0.25 + 0.75 * streaks)).astype(np.float32)


class Light:
    """Where the light is, followed smoothly so the beams don't jitter."""

    def __init__(self):
        self.at: np.ndarray | None = None

    def step(self, found: tuple[float, float] | None) -> tuple[float, float]:
        if found is not None:
            self.at = np.array(found) if self.at is None else self.at + (np.array(found) - self.at) * FOLLOW
        elif self.at is None:
            self.at = np.array([0.5, 0.15])  # No sky yet: high in the middle (the beams will be faint).
        return float(self.at[0]), float(self.at[1])


def beams(mask: np.ndarray, light: tuple[float, float], chosen: dict) -> np.ndarray:
    """The beams (CPU), 0..1, the same size as `mask`: each point gathers the light along the way back to the source,
    fading as it goes, so what blocked it leaves a shadow streak."""
    import cv2
    height, width = mask.shape
    xs, ys = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    lx, ly = light[0] * width, light[1] * height
    step_x, step_y = ((xs - lx) * chosen['reach'] / STEPS).astype(np.float32), ((ys - ly) * chosen['reach'] / STEPS).astype(np.float32)
    total = np.zeros_like(mask)
    fade = 1.0
    for k in range(1, STEPS + 1):
        total += cv2.remap(mask, (xs - step_x * k).astype(np.float32), (ys - step_y * k).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0) * fade
        fade *= chosen['decay']
    return (1 - np.exp(-total * chosen['strength'] * GAIN / STEPS)).astype(np.float32)  # Rolls off softly towards white.


def compose(frame: np.ndarray, rays_small: np.ndarray, chosen: dict) -> np.ndarray:
    """The beams added over the picture (CPU), in light's own way (screen): bright stays bright, never past white."""
    import cv2
    height, width = frame.shape[:2]
    rays = cv2.resize(rays_small, (width, height), interpolation=cv2.INTER_LINEAR)[..., None] * np.array(chosen['tint'][::-1], np.float32)  # BGR.
    picture = frame.astype(np.float32) / 255
    return (np.clip(1 - (1 - picture) * (1 - rays), 0, 1) * 255 + 0.5).astype(np.uint8)


def make(facts: MediaFacts, start: float, end: float, preset: str, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False, tune: dict | None = None) -> Path:
    """The part start..end (source seconds) with god rays, with its sound. Made once."""
    if preset not in PRESETS:
        raise ValueError('Choose soft glow, strong beams or dusty light.')
    target = target_path(facts.path, start, end, preset, tune)
    if target.is_file():
        return target
    depth = make_depth_map(facts, lambda value: on_progress(value // 3), should_cancel)
    gpu = os.environ.get('KANAA_GPU_EFFECTS') != '0'
    if gpu:
        try:
            if _make(facts, start, end, preset, depth, target, on_progress, should_cancel, gpu=True, tune=tune):
                on_progress(100)
                return target
        except JobCancelled:
            raise
        except Exception:
            logger.exception('GPU god rays failed; making them on the CPU')
    _make(facts, start, end, preset, depth, target, on_progress, should_cancel, gpu=False, tune=tune)
    on_progress(100)
    return target


def _make(facts: MediaFacts, start: float, end: float, preset: str, depth: Path, target: Path, on_progress, should_cancel, gpu: bool, tune: dict | None = None) -> bool:
    """Reads the clip and its depth in step, finds and follows the light here, and draws the beams on the GPU
    (rays_render) or here. False when the GPU tool can't be built, so the CPU path makes it."""
    import cv2
    from app.services.lens_service import _size, hardware_encoder
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
    small = (SMALL, max(2, round(height * SMALL / width)))
    span = ['-ss', f'{start:.3f}', '-t', f'{end - start:.3f}']
    depth_w, depth_h = _size(depth)
    chosen = {**PRESETS[preset], **(tune or {})}  # The preset, then any fine-tuning (look_tune).
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *span, '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={width}:{height}',
                             '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    read_depth = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *span, '-i', str(depth), '-vf', 'format=gray', '-fps_mode', 'passthrough',
                                   '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    processes = [read, read_depth]
    try:
        encoder = hardware_encoder(ffmpeg, height) if gpu else ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16']
        draw = None
        if gpu:
            draw = subprocess.Popen([str(tool), str(width), str(height), str(small[0]), str(small[1]), str(STEPS), f'{chosen["reach"]}', f'{chosen["decay"]}',
                                     f'{chosen["strength"]}', *(f'{value}' for value in chosen['tint'])], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            processes.append(draw)
        write = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra' if gpu else 'bgr24', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                                  *span, '-i', str(facts.path), '-map', '0:v', '-map', '1:a?', *encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                                  '-shortest', '-movflags', '+faststart', str(temporary)], stdin=draw.stdout if draw else subprocess.PIPE, stderr=subprocess.PIPE)
        processes.append(write)
        if draw:
            draw.stdout.close()
        light = Light()
        frame_size, depth_size, done, near_small = width * height * 3, depth_w * depth_h, 0, None
        assert read.stdout and read_depth.stdout
        while chunk := read.stdout.read(frame_size):
            if should_cancel():
                raise JobCancelled()
            if len(chunk) < frame_size:
                break
            depth_chunk = read_depth.stdout.read(depth_size)
            if len(depth_chunk) == depth_size:
                near_small = cv2.resize(np.frombuffer(depth_chunk, np.uint8).reshape(depth_h, depth_w).astype(np.float32) / 255, small, interpolation=cv2.INTER_AREA)
            frame = np.frombuffer(chunk, np.uint8).reshape(height, width, 3)
            frame_small = cv2.resize(frame, small, interpolation=cv2.INTER_AREA)
            near_now = near_small if near_small is not None else np.ones(small[::-1], np.float32)
            at = light.step(find_light(frame_small, near_now))
            mask = light_mask(frame_small, near_now, at, done / fps)
            if draw:
                # Per frame: where the light is (share of the frame), the light mask (small), then the frame.
                draw.stdin.write(struct.pack('<ff', *at) + (mask * 255 + 0.5).astype(np.uint8).tobytes() + cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA).tobytes())
            else:
                quantised = np.round(mask * 255) / 255  # As the GPU gets it: 8-bit.
                write.stdin.write(compose(frame, beams(quantised.astype(np.float32), at, chosen), chosen).tobytes())
            done += 1
            if done % 10 == 0:
                on_progress(33 + min(65, done * 65 // total))
        (draw.stdin if draw else write.stdin).close()
        if (draw and draw.wait()) or write.wait() or done == 0 or not temporary.is_file():
            raise RuntimeError(f'Could not make the god rays: {(write.stderr.read() if write.stderr else b"")[-400:]!r}')
        temporary.replace(target)
        return True
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
