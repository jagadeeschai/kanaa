"""Shot-to-shot colour match: one clip takes on the colour of another (the hero shot), so a phone clip sits beside a
camera clip, or a morning take beside an evening one, as if shot together. A few frames of each are looked at in Lab
(brightness, then green-red and blue-yellow, as eyes see them): the brightness is matched along its whole range (the
shadows to the hero's shadows, the highlights to its highlights), and the two colour axes by their middle and spread.
That is turned into one colour cube (a 3D LUT) for the whole clip, so nothing flickers from frame to frame; skin tones
move less, so faces stay natural. The result is a new video of the clip's part (with its sound), and the original is
kept to go back to.

The cube is applied on this Mac's GPU (native/lut_render.swift, Core Image's colour cube) with hardware decoding and
encoding when it can; otherwise on the CPU here, the same way (tests/test_colour_match.py compares the two).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.cutout_service import colour
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

logger = logging.getLogger(__name__)
VERSION = 4  # 4: colour stretch limited too. 2: brightness never stretched too steeply; bright warm sky is not skin. 3: gentler still (1.3x).
GPU_TOOL = Path(__file__).resolve().parents[2] / 'native' / 'lut_render.swift'
CUBE = 33  # Colour cube size: 33 steps a channel, as film LUTs.
SAMPLES = 6  # Frames looked at in each clip.
SIZE = 256  # Width they are looked at.
PERCENTILES = np.linspace(1, 99, 25)  # Where along the brightness range the two are matched.
STEEPEST = 1.3  # Most a brightness range may be stretched (or 1/STEEPEST squeezed).
DEFAULTS = {'amount': 0.9, 'skin': 0.6}  # How strongly to match; how much less skin tones move (0 the same, 1 not at all).


def target_path(source: Path, start: float, end: float, reference: Path, ref_start: float, ref_end: float, tune: dict | None = None) -> Path:
    from app.services.look_tune import key
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(start, 3), round(end, 3), str(reference), reference.stat().st_size,
                        round(ref_start, 3), round(ref_end, 3)] + ([key(tune)] if tune else []))
    return settings.data_dir / 'media' / f'match-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def sample(facts: MediaFacts, start: float, end: float) -> np.ndarray:
    """A few frames of the part, small, stacked: N×H×W×3 BGR."""
    height = max(2, round((facts.height or 1080) * SIZE / (facts.width or 1920) / 2) * 2)
    frames = []
    for k in range(SAMPLES):
        at = start + (end - start) * (k + 0.5) / SAMPLES
        raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{at:.3f}', '-i', str(facts.path), '-frames:v', '1',
                              '-vf', f'{colour(facts)},scale={SIZE}:{height}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True).stdout
        if len(raw) >= SIZE * height * 3:
            frames.append(np.frombuffer(raw[:SIZE * height * 3], np.uint8).reshape(height, SIZE, 3))
    if not frames:
        raise ValueError('Could not read the clip to match.')
    return np.stack(frames)


def _lab(bgr: np.ndarray) -> np.ndarray:
    import cv2
    flat = bgr.reshape(-1, 1, 3)
    return cv2.cvtColor((flat.astype(np.float32) / 255) if flat.dtype == np.uint8 else flat, cv2.COLOR_BGR2LAB).reshape(-1, 3)


def skin_share(bgr: np.ndarray) -> np.ndarray:
    """How skin-like each colour is, 0..1 (a soft range in YCrCb, which holds for every skin tone)."""
    import cv2
    flat = bgr.reshape(-1, 1, 3)
    ycc = cv2.cvtColor((flat.astype(np.float32) / 255) if flat.dtype == np.uint8 else flat, cv2.COLOR_BGR2YCrCb).reshape(-1, 3)
    cr, cb, y = ycc[:, 1], ycc[:, 2], ycc[:, 0]
    inside = lambda value, low, high, soft: np.clip(np.minimum(value - low, high - value) / soft + 0.5, 0, 1)
    # Skin is never the brightest thing in a picture: bright warm colours are sky, sun and light, not faces.
    middling = np.clip((y - 0.15) / 0.1, 0, 1) * np.clip((0.82 - y) / 0.08, 0, 1)
    return (inside(cr, 0.53, 0.68, 0.02) * inside(cb, 0.30, 0.50, 0.02) * middling).astype(np.float32)


def build_cube(reference: np.ndarray, target: np.ndarray, tune: dict | None = None) -> np.ndarray:
    """The colour cube taking `target`'s colours onto `reference`'s: CUBE³ entries of RGB 0..1, red fastest (as Core
    Image's colour cube reads it)."""
    import cv2
    chosen = {**DEFAULTS, **(tune or {})}
    ref, tgt = _lab(reference), _lab(target)
    # Brightness along its whole range; the colour axes by middle and spread (gently: never more than double).
    l_from, l_to = np.percentile(tgt[:, 0], PERCENTILES), np.percentile(ref[:, 0], PERCENTILES)
    l_from = np.maximum.accumulate(l_from + np.arange(len(l_from)) * 1e-4)  # Strictly rising, for the mapping.
    # Never stretch or squeeze brightness too steeply: stretching a narrow band (a hazy sky) blows up the video's own
    # compression blocks, and squeezing flattens it. Rebuild the curve from limited slopes, keeping its middle in place.
    slopes = np.clip(np.diff(l_to) / np.maximum(np.diff(l_from), 1e-3), 1 / STEEPEST, STEEPEST)
    curve = np.concatenate([[0.0], np.cumsum(slopes * np.diff(l_from))])
    l_to = curve + (np.median(l_to) - np.median(curve))
    # Colour is stored coarser than brightness in video (in blocks); stretching it far shows the blocks, so it is
    # limited the same way.
    spreads = [np.clip(ref[:, k].std() / max(tgt[:, k].std(), 1e-3), 1 / STEEPEST, STEEPEST) for k in (1, 2)]
    steps = np.linspace(0, 1, CUBE, dtype=np.float32)
    blue, green, red = np.meshgrid(steps, steps, steps, indexing='ij')  # Red fastest.
    grid_bgr = np.stack([blue, green, red], axis=-1).reshape(-1, 3)
    lab = _lab(grid_bgr.astype(np.float32))
    moved = lab.copy()
    moved[:, 0] = np.interp(lab[:, 0], l_from, l_to, left=None, right=None)
    # Outside the measured range, keep the slope: a straight line from the ends (no clipped blacks or whites).
    low, high = lab[:, 0] < l_from[0], lab[:, 0] > l_from[-1]
    moved[low, 0] = lab[low, 0] * (l_to[0] / max(l_from[0], 1e-3))
    moved[high, 0] = 100 - (100 - lab[high, 0]) * ((100 - l_to[-1]) / max(100 - l_from[-1], 1e-3))
    for axis, spread in zip((1, 2), spreads):
        moved[:, axis] = (lab[:, axis] - tgt[:, axis].mean()) * spread + ref[:, axis].mean()
    out = cv2.cvtColor(moved.reshape(-1, 1, 3).astype(np.float32), cv2.COLOR_LAB2BGR).reshape(-1, 3)
    # Skin moves less; and the whole match only as strongly as asked.
    keep = (chosen['skin'] * skin_share(grid_bgr.astype(np.float32)))[:, None]
    out = out + (grid_bgr - out) * keep
    out = grid_bgr + (out - grid_bgr) * chosen['amount']
    return np.clip(out[:, ::-1], 0, 1).astype(np.float32)  # RGB.


def apply_cube(frame: np.ndarray, cube: np.ndarray) -> np.ndarray:
    """One frame through the cube (CPU), trilinear, as Core Image does. frame: H×W×3 BGR uint8."""
    grid = cube.reshape(CUBE, CUBE, CUBE, 3)  # [blue][green][red] -> RGB.
    rgb = frame[..., ::-1].astype(np.float32) / 255 * (CUBE - 1)
    lo = np.floor(rgb).astype(np.int32).clip(0, CUBE - 2)
    f = rgb - lo
    r0, g0, b0 = lo[..., 0], lo[..., 1], lo[..., 2]
    fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]
    at = lambda db, dg, dr: grid[b0 + db, g0 + dg, r0 + dr]
    c00 = at(0, 0, 0) * (1 - fr) + at(0, 0, 1) * fr
    c01 = at(0, 1, 0) * (1 - fr) + at(0, 1, 1) * fr
    c10 = at(1, 0, 0) * (1 - fr) + at(1, 0, 1) * fr
    c11 = at(1, 1, 0) * (1 - fr) + at(1, 1, 1) * fr
    out = (c00 * (1 - fg) + c01 * fg) * (1 - fb) + (c10 * (1 - fg) + c11 * fg) * fb
    return (np.clip(out[..., ::-1], 0, 1) * 255 + 0.5).astype(np.uint8)


def make(facts: MediaFacts, start: float, end: float, reference: MediaFacts, ref_start: float, ref_end: float,
         on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False, tune: dict | None = None) -> Path:
    """The part start..end (source seconds) in the colour of reference's part, with its sound. Made once."""
    target = target_path(facts.path, start, end, reference.path, ref_start, ref_end, tune)
    if target.is_file():
        return target
    cube = build_cube(sample(reference, ref_start, ref_end), sample(facts, start, end), tune)
    on_progress(10)
    if os.environ.get('KANAA_GPU_EFFECTS') != '0':
        try:
            if _make(facts, start, end, cube, target, on_progress, should_cancel, gpu=True):
                on_progress(100)
                return target
        except JobCancelled:
            raise
        except Exception:
            logger.exception('GPU colour match failed; making it on the CPU')
    _make(facts, start, end, cube, target, on_progress, should_cancel, gpu=False)
    on_progress(100)
    return target


def _make(facts: MediaFacts, start: float, end: float, cube: np.ndarray, target: Path, on_progress, should_cancel, gpu: bool) -> bool:
    import tempfile
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
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    pix = 'bgra' if gpu else 'bgr24'
    with tempfile.TemporaryDirectory() as folder:
        cube_file = Path(folder) / 'cube.raw'
        cube_file.write_bytes(np.concatenate([cube, np.ones((len(cube), 1), np.float32)], axis=1).astype(np.float32).tobytes())  # RGBA floats.
        read = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', *(['-hwaccel', 'videotoolbox'] if gpu else []), *span, '-i', str(facts.path), '-an',
                                 '-vf', f'{colour(facts)},scale={width}:{height}', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', pix, '-'],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        processes = [read]
        try:
            draw = None
            if gpu:
                draw = subprocess.Popen([str(tool), str(width), str(height), str(CUBE), str(cube_file)], stdin=read.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                processes.append(draw)
                read.stdout.close()
            encoder = hardware_encoder(ffmpeg, height) if gpu else ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16']
            write = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', pix, '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                                      *span, '-i', str(facts.path), '-map', '0:v', '-map', '1:a?', *encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                                      '-shortest', '-movflags', '+faststart', str(temporary)], stdin=draw.stdout if draw else subprocess.PIPE, stderr=subprocess.PIPE)
            processes.append(write)
            if draw:
                draw.stdout.close()
                for line in draw.stderr:
                    if should_cancel():
                        raise JobCancelled()
                    if line.startswith(b'frame '):
                        on_progress(10 + min(88, int(line.split()[1]) * 88 // total))
                if draw.wait():
                    raise RuntimeError(f'lut_render {draw.returncode}')
            else:
                done, size = 0, width * height * 3
                while chunk := read.stdout.read(size):
                    if should_cancel():
                        raise JobCancelled()
                    if len(chunk) < size:
                        break
                    write.stdin.write(apply_cube(np.frombuffer(chunk, np.uint8).reshape(height, width, 3), cube).tobytes())
                    done += 1
                    if done % 10 == 0:
                        on_progress(10 + min(88, done * 88 // total))
                write.stdin.close()
            if write.wait() or not temporary.is_file():
                raise RuntimeError(f'Could not make the colour match: {(write.stderr.read() if write.stderr else b"")[-300:]!r}')
            temporary.replace(target)
            return True
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
            temporary.unlink(missing_ok=True)
