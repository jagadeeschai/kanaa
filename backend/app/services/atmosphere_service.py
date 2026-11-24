"""Atmosphere from depth: mist, dusty sunset light, rain haze or low fog laid into a clip at the right distance, from
its depth map (depth_mask_service): the further away, the thicker, so the people in front stay clear while the city
behind them fades into the air. Low fog lies over the far land only, leaving the sky clear. The result is a new video of the clip's
part (with its sound), so it plays and exports like any clip, and the original is kept to go back to.

Made on this Mac's GPU (native/atmosphere_render.swift, Core Image) with hardware decoding and encoding when it can;
otherwise on the CPU here, with the same formula (tests/test_atmosphere.py compares the two).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
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
VERSION = 4  # 2: low fog by distance (not by height), sunset capped. 3: no glow along the skyline. 4: low fog kept off the sky at the skyline.
GPU_TOOL = Path(__file__).resolve().parents[2] / 'native' / 'atmosphere_render.swift'
# Colour of the air (R, G, B), how thick it gets far away, how much it keeps off the sky (0 sky too, 1 land only), how
# much colour it takes out of what it covers, and the most it ever covers (so the sun and the far scene show through).
PRESETS = {
    'mist': {'colour': (232, 236, 240), 'density': 0.78, 'land': 0.0, 'fade': 0.25, 'most': 0.92},
    'sunset': {'colour': (236, 186, 140), 'density': 0.55, 'land': 0.0, 'fade': 0.1, 'most': 0.55},
    'rain': {'colour': (150, 164, 178), 'density': 0.72, 'land': 0.0, 'fade': 0.45, 'most': 0.92},
    'low-fog': {'colour': (228, 230, 234), 'density': 1.1, 'land': 1.0, 'fade': 0.3, 'most': 0.9},
}
STRENGTH = {'light': 0.6, 'medium': 1.0, 'heavy': 1.4}
CURVE = 1.6  # Far away thickens faster than near: (1 − nearness) ** CURVE.
SKY_FROM, SKY_TO = 0.03, 0.12  # Nearness: below the first is sky (no low fog), past the second is land (all of it).
SHRINK = 1 / 40  # How far (share of the height) the land is pulled back from the sky for low fog.


def target_path(source: Path, start: float, end: float, preset: str, strength: str) -> Path:
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), preset, strength])
    return settings.data_dir / 'media' / f'atmosphere-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def settings_for(preset: str, strength: str) -> dict:
    if preset not in PRESETS or strength not in STRENGTH:
        raise ValueError('Choose an atmosphere and how strong.')
    chosen = dict(PRESETS[preset])
    chosen['density'] = chosen['density'] * STRENGTH[strength]
    return chosen


def air_frame(frame: np.ndarray, near: np.ndarray, chosen: dict) -> np.ndarray:
    """One frame with the air laid in. frame: H×W×3 uint8 (BGR); near: nearness 0 far to 1 near, any size."""
    import cv2
    height, width = frame.shape[:2]
    near = cv2.GaussianBlur(cv2.resize(near.astype(np.float32), (width, height), interpolation=cv2.INTER_LINEAR), (0, 0), height / 180)
    # Fog on the land is never thicker than on the farthest land: at the skyline, where nearness passes through
    # 'very far' on its way to the sky, it would otherwise glow along the edge.
    far = 1 - np.clip(np.maximum(near, SKY_TO * chosen['land']), 0, 1)
    amount = np.clip(chosen['density'] * far ** CURVE, 0, chosen['most'])
    if chosen['land']:
        # The depth map is soft at the skyline: land bleeds up into the sky. Pulled back a little first, the fog starts
        # just below the skyline instead of glowing on the sky above it.
        radius = max(1, round(height * SHRINK))
        shrunk = cv2.erode(near, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)))
        land = np.clip((shrunk - SKY_FROM) / (SKY_TO - SKY_FROM), 0, 1)
        amount = amount * (1 - chosen['land'] + chosen['land'] * land)
    picture = frame.astype(np.float32)
    grey = picture.mean(axis=2, keepdims=True)
    faded = picture + (grey - picture) * (chosen['fade'] * amount)[..., None]  # The air takes colour out of what it covers.
    air = np.array(chosen['colour'][::-1], np.float32)  # BGR.
    return np.clip(faded + (air - faded) * amount[..., None] + 0.5, 0, 255).astype(np.uint8)


def make(facts: MediaFacts, start: float, end: float, preset: str, strength: str, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The part start..end (source seconds) with the air laid in, with its sound. Made once."""
    chosen = settings_for(preset, strength)
    target = target_path(facts.path, start, end, preset, strength)
    if target.is_file():
        return target
    depth = make_depth_map(facts, lambda value: on_progress(value // 3), should_cancel)
    if os.environ.get('KANAA_GPU_EFFECTS') != '0':
        try:
            if _make_gpu(facts, start, end, chosen, depth, target, on_progress, should_cancel):
                on_progress(100)
                return target
        except JobCancelled:
            raise
        except Exception:
            logger.exception('GPU atmosphere failed; making it on the CPU')
    _make_cpu(facts, start, end, chosen, depth, target, on_progress, should_cancel)
    on_progress(100)
    return target


def _geometry(facts: MediaFacts, start: float, end: float):
    width, height = facts.width or 1920, facts.height or 1080
    width, height = width - width % 2, height - height % 2
    fps = facts.fps or 30
    return width, height, fps, max(1, round((end - start) * fps)), ['-ss', f'{start:.3f}', '-t', f'{end - start:.3f}']


def _writer(ffmpeg: str, facts: MediaFacts, size: tuple[int, int], fps: float, span: list[str], pix: str, temporary: Path, encoder: list[str], stdin) -> subprocess.Popen:
    return subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', pix, '-s', f'{size[0]}x{size[1]}', '-r', f'{fps}', '-i', '-',
                             *span, '-i', str(facts.path), '-map', '0:v', '-map', '1:a?', *encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                             '-shortest', '-movflags', '+faststart', str(temporary)], stdin=stdin, stderr=subprocess.PIPE)


def _make_gpu(facts: MediaFacts, start: float, end: float, chosen: dict, depth: Path, target: Path, on_progress: Callable[[int], None],
              should_cancel: Callable[[], bool]) -> bool:
    """ffmpeg decodes (in hardware) into atmosphere_render (the air, on the GPU), into the hardware encoder. False when
    this Mac can't (no Swift tools), so the CPU path makes it."""
    from app.services.cutout_service import helper
    from app.services.lens_service import _size, hardware_encoder
    try:
        tool = helper(GPU_TOOL)
    except RuntimeError:
        return False
    ffmpeg = shutil.which('ffmpeg')
    width, height, fps, total, span = _geometry(facts, start, end)
    depth_w, depth_h = _size(depth)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    red, green, blue = (value / 255 for value in chosen['colour'])
    with tempfile.TemporaryDirectory() as folder:
        fifo = Path(folder) / 'depth.raw'
        os.mkfifo(fifo)
        processes: list[subprocess.Popen] = []
        try:
            read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-hwaccel', 'videotoolbox', *span, '-i', str(facts.path), '-an',
                                     '-vf', f'{colour(facts)},scale={width}:{height}', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-'],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            processes.append(read)
            processes.append(subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', *span, '-i', str(depth), '-vf', 'format=gray', '-fps_mode', 'passthrough',
                                               '-f', 'rawvideo', '-pix_fmt', 'gray', str(fifo)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            air = subprocess.Popen([str(tool), str(width), str(height), str(depth_w), str(depth_h), f'{red}', f'{green}', f'{blue}', f'{chosen["density"]}',
                                    f'{chosen["land"]}', f'{chosen["fade"]}', f'{chosen["most"]}', str(fifo)], stdin=read.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            processes.append(air)
            assert read.stdout and air.stdout and air.stderr
            read.stdout.close()
            write = _writer(ffmpeg, facts, (width, height), fps, span, 'bgra', temporary, hardware_encoder(ffmpeg, height), air.stdout)
            processes.append(write)
            air.stdout.close()
            for line in air.stderr:
                if should_cancel():
                    raise JobCancelled()
                if line.startswith(b'frame '):
                    on_progress(33 + min(65, int(line.split()[1]) * 65 // total))
            if air.wait() or write.wait() or not temporary.is_file():
                raise RuntimeError(f'atmosphere_render {air.returncode}, ffmpeg {write.returncode}: {(write.stderr.read() if write.stderr else b"")[-500:]!r}')
            temporary.replace(target)
            return True
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
            temporary.unlink(missing_ok=True)


def _make_cpu(facts: MediaFacts, start: float, end: float, chosen: dict, depth: Path, target: Path, on_progress: Callable[[int], None],
              should_cancel: Callable[[], bool]) -> None:
    from app.services.lens_service import _size
    ffmpeg = shutil.which('ffmpeg')
    width, height, fps, total, span = _geometry(facts, start, end)
    depth_w, depth_h = _size(depth)
    read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *span, '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={width}:{height}',
                             '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    read_depth = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *span, '-i', str(depth), '-vf', 'format=gray', '-fps_mode', 'passthrough',
                                   '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    write = _writer(ffmpeg, facts, (width, height), fps, span, 'bgr24', temporary, ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16'], subprocess.PIPE)
    try:
        assert read.stdout and read_depth.stdout and write.stdin
        frame_size, depth_size, done, near = width * height * 3, depth_w * depth_h, 0, None
        while chunk := read.stdout.read(frame_size):
            if should_cancel():
                raise JobCancelled()
            if len(chunk) < frame_size:
                break
            depth_chunk = read_depth.stdout.read(depth_size)
            if len(depth_chunk) == depth_size:
                near = np.frombuffer(depth_chunk, np.uint8).reshape(depth_h, depth_w).astype(np.float32) / 255
            frame = np.frombuffer(chunk, np.uint8).reshape(height, width, 3)
            write.stdin.write(frame.tobytes() if near is None else air_frame(frame, near, chosen).tobytes())
            done += 1
            if done % 10 == 0:
                on_progress(33 + min(65, done * 65 // total))
        write.stdin.close()
        if write.wait() or done == 0:
            raise RuntimeError('Could not make the atmosphere copy.')
        temporary.replace(target)
    finally:
        for process in (read, read_depth, write):
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
