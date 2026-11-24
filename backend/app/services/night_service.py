"""Day for night: a daytime shot turned into a believable night, the way films have always shot their nights. The
daytime sky, the brightest part of any day shot and the first thing that gives a fake night away, goes deep night-blue;
the land sinks into darkness with distance (from the clip's depth map) while what is near, the people, stays readable,
as if lit by the moon; colour drains towards blue, as eyes see at night. The result is a new video of the clip's part
(with its sound), so it plays and exports like any clip, and the original is kept to go back to.

Made on this Mac's GPU (native/night_render.swift, Core Image) with hardware decoding and encoding when it can;
otherwise on the CPU here, with the same formula (tests/test_day_for_night.py compares the two).
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
VERSION = 1
GPU_TOOL = Path(__file__).resolve().parents[2] / 'native' / 'night_render.swift'
# How bright the land is kept (the nearest of it; far land less), how bright the sky, and how much colour is kept.
MOODS = {
    'moonlit': {'land': 0.5, 'sky': 0.3, 'colour': 0.45},
    'dark': {'land': 0.34, 'sky': 0.17, 'colour': 0.35},
}
MOON = (0.72, 0.86, 1.18)  # Moonlight's colour on the land (R, G, B gain).
NIGHT_SKY = (0.42, 0.58, 1.12)  # The night sky's colour (R, G, B gain on its brightness).
FLOOR = (0.012, 0.02, 0.045)  # The darkest a night ever gets: never pure black, a deep blue.
FAR = 0.45  # How much darker the farthest land is than the nearest.
SKY_FROM, SKY_TO = 0.03, 0.12  # Nearness: below the first is sky, past the second is land.


def target_path(source: Path, start: float, end: float, mood: str) -> Path:
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), mood])
    return settings.data_dir / 'media' / f'night-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def settings_for(mood: str) -> dict:
    if mood not in MOODS:
        raise ValueError('Choose moonlit or deep night.')
    return dict(MOODS[mood])


def night_frame(frame: np.ndarray, near: np.ndarray, chosen: dict) -> np.ndarray:
    """One frame by night. frame: H×W×3 uint8 (BGR); near: nearness 0 far to 1 near, any size."""
    import cv2
    height, width = frame.shape[:2]
    near = np.clip(cv2.GaussianBlur(cv2.resize(near.astype(np.float32), (width, height), interpolation=cv2.INTER_LINEAR), (0, 0), height / 180), 0, 1)
    rgb = frame[..., ::-1].astype(np.float32) / 255
    grey = (rgb @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    drained = grey + (rgb - grey) * chosen['colour']
    land = drained * (chosen['land'] * (1 - FAR * (1 - near)))[..., None] * np.array(MOON, np.float32)
    sky = grey * chosen['sky'] * np.array(NIGHT_SKY, np.float32)
    share = (1 - np.clip((near - SKY_FROM) / (SKY_TO - SKY_FROM), 0, 1))[..., None]
    out = np.maximum(land + (sky - land) * share, np.array(FLOOR, np.float32))
    return (np.clip(out, 0, 1)[..., ::-1] * 255 + 0.5).astype(np.uint8)


def make(facts: MediaFacts, start: float, end: float, mood: str, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The part start..end (source seconds) by night, with its sound. Made once."""
    chosen = settings_for(mood)
    target = target_path(facts.path, start, end, mood)
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
            logger.exception('GPU day for night failed; making it on the CPU')
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
    """ffmpeg decodes (in hardware) into night_render (the night, on the GPU), into the hardware encoder. False when
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
            air = subprocess.Popen([str(tool), str(width), str(height), str(depth_w), str(depth_h), f'{chosen["land"]}', f'{chosen["sky"]}', f'{chosen["colour"]}', str(fifo)], stdin=read.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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
                raise RuntimeError(f'night_render {air.returncode}, ffmpeg {write.returncode}: {(write.stderr.read() if write.stderr else b"")[-500:]!r}')
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
            write.stdin.write(frame.tobytes() if near is None else night_frame(frame, near, chosen).tobytes())
            done += 1
            if done % 10 == 0:
                on_progress(33 + min(65, done * 65 // total))
        write.stdin.close()
        if write.wait() or done == 0:
            raise RuntimeError('Could not make the night copy.')
        temporary.replace(target)
    finally:
        for process in (read, read_depth, write):
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
