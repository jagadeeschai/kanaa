"""Sky swap: a new sky in one click (golden sunset, starry night, storm clouds, clear blue), and the land relit to
match it. The sky is found in every frame from the clip's depth map (it is the farthest thing there is: nearness 0)
and its edge sharpened against the picture itself (a guided filter), so trees and rooftops stay crisp against the new
sky. The skies are drawn here, not taken from anywhere. As the camera pans, the distant land is followed from frame to
frame and the new sky moves with it, so it stays put in the world. The result is a new video of the clip's part, with
its sound, and the original is kept to go back to.

Composited on this Mac's GPU (native/sky_render.swift, Core Image) with the hardware encoder when it can; otherwise
on the CPU here, with the same formula (tests/test_sky_swap.py compares the two).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.cutout_service import colour
from app.services.depth_mask_service import make_depth_map
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

logger = logging.getLogger(__name__)
VERSION = 2  # 2: the new sky's horizon where the clip's is; night and storm relit more.
GPU_TOOL = Path(__file__).resolve().parents[2] / 'native' / 'sky_render.swift'
SKY_FROM, SKY_TO = 0.02, 0.07  # Nearness: below the first is sky, past the second is land.
SMALL = 640  # Width the sky is found and the camera followed at.
MARGIN = 0.15  # The new sky is this much larger than the frame each way, room to follow the camera.
# The new sky, and how the land takes its light: (R, G, B) gain on the land, and how much (more on far land).
SKIES = {
    'sunset': {'gain': (1.12, 0.92, 0.74), 'amount': 0.55},
    'night': {'gain': (0.42, 0.5, 0.78), 'amount': 0.9},
    'storm': {'gain': (0.78, 0.8, 0.84), 'amount': 0.75},
    'blue': {'gain': (0.98, 1.02, 1.08), 'amount': 0.4},
}


def target_path(source: Path, start: float, end: float, sky: str) -> Path:
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), sky])
    return settings.data_dir / 'media' / f'sky-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def _clouds(width: int, height: int, seed: int, scale: float) -> np.ndarray:
    """Soft cloud shapes, 0..1: noise added up at several sizes, wider than tall (clouds lie flat)."""
    import cv2
    rng = np.random.default_rng(seed)
    out = np.zeros((height, width), np.float32)
    weight = 1.0
    for octave in range(6):
        cells = (max(2, int(width / (scale * 2 ** -octave) / 3)), max(2, int(height / (scale * 2 ** -octave))))
        out += weight * cv2.resize(rng.random((cells[1], cells[0]), dtype=np.float32), (width, height), interpolation=cv2.INTER_CUBIC)
        weight *= 0.5
    out -= out.min()
    return out / max(out.max(), 1e-6)


def paint_sky(sky: str, width: int, height: int, horizon: float = 1.0) -> np.ndarray:
    """The new sky, BGR, `width`×`height` (already larger than the frame by MARGIN each way), its horizon (the warm
    glow, the sun) at `horizon`, a share of its height: where the land meets the sky in the clip."""
    rows = np.clip(np.arange(height, dtype=np.float32) / max(1.0, horizon * height), 0, 1)[:, None, None]  # 0 top, 1 horizon.
    blend = lambda top, bottom, curve=1.0: (np.array(top, np.float32) + (np.array(bottom, np.float32) - np.array(top, np.float32)) * rows ** curve)
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    if sky == 'sunset':
        picture = blend((70, 40, 95), (40, 120, 250), 1.6)  # Deep violet above, molten orange at the horizon (BGR).
        sun_y = 0.86 * horizon * height
        sun = np.exp(-(((xs - 0.68 * width) ** 2 + (ys - sun_y) ** 2) / (2 * (0.045 * horizon * height) ** 2)))[..., None]
        glow = np.exp(-(((xs - 0.68 * width) ** 2 / 4 + (ys - sun_y) ** 2) / (2 * (0.3 * horizon * height) ** 2)))[..., None]
        picture = picture + glow * np.array((40, 110, 120)) + sun * np.array((200, 245, 255))
        clouds = _clouds(width, height, 3, width / 3)[..., None]
        streak = np.clip((clouds - 0.55) * 3, 0, 1) * np.clip(rows * 1.4, 0, 1)
        picture = picture * (1 - 0.55 * streak) + np.array((110, 90, 200), np.float32) * 0.55 * streak  # Pink-lit wisps.
    elif sky == 'night':
        picture = blend((25, 8, 5), (70, 35, 20), 1.3)  # Near black above, deep blue at the horizon.
        rng = np.random.default_rng(7)
        stars = np.zeros((height, width), np.float32)
        count = int(width * height / 900)
        stars[rng.integers(0, height, count), rng.integers(0, width, count)] = rng.random(count) ** 3
        import cv2
        stars = cv2.GaussianBlur(stars, (0, 0), 0.8) * 9
        picture = picture + np.clip(stars, 0, 1)[..., None] * np.array((255, 250, 235)) * (1 - rows * 0.7)
        moon_y = 0.45 * horizon * height
        moon = np.exp(-(((xs - 0.25 * width) ** 2 + (ys - moon_y) ** 2) / (2 * (0.025 * height) ** 2)))[..., None]
        picture = picture + moon * np.array((215, 235, 245)) + np.exp(-(((xs - 0.25 * width) ** 2 + (ys - moon_y) ** 2) / (2 * (0.12 * height) ** 2)))[..., None] * np.array((50, 40, 30))
    elif sky == 'storm':
        picture = blend((96, 94, 92), (168, 170, 172), 1.0)
        clouds = _clouds(width, height, 11, width / 5)[..., None]
        detail = _clouds(width, height, 12, width / 14)[..., None]
        shape = np.clip(0.65 * clouds + 0.35 * detail, 0, 1)
        picture = picture * (0.45 + 0.95 * shape)  # Lit tops, dark heavy bellies.
    else:  # blue
        picture = blend((190, 120, 45), (245, 215, 170), 1.4)
        clouds = _clouds(width, height, 5, width / 3)[..., None]
        puffs = np.clip((clouds - 0.62) * 4, 0, 1) * np.clip(1.2 - rows, 0, 1)
        picture = picture * (1 - puffs) + 250 * puffs
    return np.clip(picture + 0.5, 0, 255).astype(np.uint8)


def horizon_of(mask: np.ndarray) -> float | None:
    """Where the land meets the sky, as a share of the height: in each column with sky at the top, the first row of
    land below it; the middle of them. None when there is no sky."""
    columns = [int(np.argmax(column < 0.5)) for column in mask.T if column[:3].mean() > 0.5 and (column < 0.5).any()]
    return float(np.median(columns) / mask.shape[0]) if len(columns) >= mask.shape[1] // 10 else None


def sky_mask(frame_small: np.ndarray, near_small: np.ndarray) -> np.ndarray:
    """Where the sky is, 0..1, from the nearness and sharpened against the picture's own edges."""
    import cv2
    rough = np.clip((SKY_TO - near_small) / (SKY_TO - SKY_FROM), 0, 1).astype(np.float32)
    guide = cv2.cvtColor(frame_small, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    sharp = cv2.ximgproc.guidedFilter(guide, rough, max(2, frame_small.shape[1] // 160), 1e-3)
    return np.clip((sharp - 0.15) / 0.7, 0, 1).astype(np.float32)


class Follow:
    """Follows the camera by the distant land (not the sky, which has nothing to hold on to): how far the scene has
    moved since the first frame, in full-size pixels."""

    def __init__(self, scale: float):
        self.scale, self.last, self.total = scale, None, np.zeros(2, np.float64)

    def step(self, frame_small: np.ndarray, sky: np.ndarray, near_small: np.ndarray) -> tuple[float, float]:
        import cv2
        grey = cv2.cvtColor(frame_small, cv2.COLOR_BGR2GRAY).astype(np.float32)
        far_land = ((sky < 0.2) & (near_small < 0.55)).astype(np.float32)  # Far land moves most like the sky would.
        if self.last is not None and far_land.mean() > 0.02:
            window = cv2.createHanningWindow(grey.shape[::-1], cv2.CV_32F) * cv2.GaussianBlur(far_land, (0, 0), 3)
            (dx, dy), response = cv2.phaseCorrelate(self.last, grey, window)
            if response > 0.05 and abs(dx) < grey.shape[1] / 8 and abs(dy) < grey.shape[0] / 8:
                self.total += (dx * self.scale, dy * self.scale)
        self.last = grey
        return float(self.total[0]), float(self.total[1])


def compose(frame: np.ndarray, sky_picture: np.ndarray, mask_small: np.ndarray, near: np.ndarray, moved: tuple[float, float], light: dict) -> np.ndarray:
    """One frame (CPU): the land relit by the new sky, the new sky where the old one was, moved with the camera.
    frame: H×W×3 BGR; sky_picture: larger by MARGIN each way; mask_small, near: any size."""
    import cv2
    height, width = frame.shape[:2]
    sky_h, sky_w = sky_picture.shape[:2]
    left, top = (sky_w - width) / 2 - moved[0], (sky_h - height) / 2 - moved[1]
    lay = np.float32([[1, 0, -left], [0, 1, -top]])
    sky = cv2.warpAffine(sky_picture, lay, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
    mask = cv2.resize(mask_small, (width, height), interpolation=cv2.INTER_LINEAR)[..., None]
    far = 1 - np.clip(cv2.resize(near, (width, height), interpolation=cv2.INTER_LINEAR), 0, 1)[..., None]
    gain = np.array(light['gain'][::-1], np.float32)  # BGR.
    share = light['amount'] * (0.7 + 0.3 * far)  # All the land takes the sky's light; far land a little more.
    land = frame.astype(np.float32) * (1 + (gain - 1) * share)
    return np.clip(land * (1 - mask) + sky * mask + 0.5, 0, 255).astype(np.uint8)


def make(facts: MediaFacts, start: float, end: float, sky: str, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The part start..end (source seconds) under a new sky, with its sound. Made once."""
    if sky not in SKIES:
        raise ValueError('Choose a sunset, a starry night, storm clouds or a clear blue sky.')
    target = target_path(facts.path, start, end, sky)
    if target.is_file():
        return target
    depth = make_depth_map(facts, lambda value: on_progress(value // 3), should_cancel)
    gpu = os.environ.get('KANAA_GPU_EFFECTS') != '0'
    if gpu:
        try:
            if _make(facts, start, end, sky, depth, target, on_progress, should_cancel, gpu=True):
                on_progress(100)
                return target
        except JobCancelled:
            raise
        except Exception:
            logger.exception('GPU sky swap failed; making it on the CPU')
    _make(facts, start, end, sky, depth, target, on_progress, should_cancel, gpu=False)
    on_progress(100)
    return target


def _first(facts: MediaFacts, depth: Path, at: float, small: tuple[int, int]):
    """The first frame and its nearness, small, to find the horizon."""
    import cv2
    ffmpeg = shutil.which('ffmpeg')
    grab = lambda path, extra, pix, depth_of: subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-ss', f'{at:.3f}', '-i', str(path), '-frames:v', '1', '-vf',
                                                             f'{extra}scale={small[0]}:{small[1]}', '-f', 'rawvideo', '-pix_fmt', pix, '-'], capture_output=True).stdout
    frame, near = grab(facts.path, f'{colour(facts)},', 'bgr24', 3), grab(depth, 'format=gray,', 'gray', 1)
    if len(frame) < small[0] * small[1] * 3 or len(near) < small[0] * small[1]:
        return None
    return (np.frombuffer(frame[:small[0] * small[1] * 3], np.uint8).reshape(small[1], small[0], 3),
            np.frombuffer(near[:small[0] * small[1]], np.uint8).reshape(small[1], small[0]).astype(np.float32) / 255)


def _make(facts: MediaFacts, start: float, end: float, sky: str, depth: Path, target: Path, on_progress, should_cancel, gpu: bool) -> bool:
    """Reads the clip and its depth in step; finds the sky and follows the camera here; composites on the GPU
    (sky_render) or here. False when the GPU tool can't be built, so the CPU path makes it."""
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
    light = SKIES[sky]
    first = _first(facts, depth, start, small)
    seen = horizon_of(sky_mask(*first)) if first else None
    # The new sky's horizon goes where the clip's is (in the larger picture: MARGIN above the frame's top).
    horizon = ((seen if seen is not None else 0.5) + MARGIN) / (1 + 2 * MARGIN)
    picture = paint_sky(sky, round(width * (1 + 2 * MARGIN)), round(height * (1 + 2 * MARGIN)), horizon)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *span, '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={width}:{height}',
                             '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    read_depth = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *span, '-i', str(depth), '-vf', 'format=gray', '-fps_mode', 'passthrough',
                                   '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    processes = [read, read_depth]
    folder = tempfile.TemporaryDirectory()
    try:
        encoder = hardware_encoder(ffmpeg, height) if gpu else ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16']
        draw = None
        if gpu:
            sky_file = Path(folder.name) / 'sky.raw'
            sky_file.write_bytes(cv2.cvtColor(picture, cv2.COLOR_BGR2BGRA).tobytes())
            draw = subprocess.Popen([str(tool), str(width), str(height), str(small[0]), str(small[1]), str(picture.shape[1]), str(picture.shape[0]),
                                     *(f'{value}' for value in light['gain']), f'{light["amount"]}', str(sky_file)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            processes.append(draw)
        write = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra' if gpu else 'bgr24', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                                  *span, '-i', str(facts.path), '-map', '0:v', '-map', '1:a?', *encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                                  '-shortest', '-movflags', '+faststart', str(temporary)], stdin=draw.stdout if draw else subprocess.PIPE, stderr=subprocess.PIPE)
        processes.append(write)
        if draw:
            draw.stdout.close()
        follow = Follow(width / small[0])
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
            near = near_small if near_small is not None else np.ones(small[::-1], np.float32)
            mask = sky_mask(frame_small, near)
            moved = follow.step(frame_small, mask, near)
            if draw:
                # Per frame: how far the camera moved, then the sky and nearness (small), then the frame.
                draw.stdin.write(struct.pack('<ff', *moved) + (mask * 255 + 0.5).astype(np.uint8).tobytes() + (np.clip(near, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes()
                                 + cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA).tobytes())
            else:
                write.stdin.write(compose(frame, picture, mask, near, moved, light).tobytes())
            done += 1
            if done % 10 == 0:
                on_progress(33 + min(65, done * 65 // total))
        (draw.stdin if draw else write.stdin).close()
        if (draw and draw.wait()) or write.wait() or done == 0 or not temporary.is_file():
            raise RuntimeError(f'Could not make the new sky: {(write.stderr.read() if write.stderr else b"")[-400:]!r}')
        temporary.replace(target)
        return True
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
        folder.cleanup()
