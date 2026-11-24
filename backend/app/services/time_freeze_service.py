"""Time freeze in 3D: the moment stops and the camera glides around the frozen scene, like bullet time, from one
ordinary clip. The held frame is split into the people (Apple Vision's person finder, on this Mac) and the scene
behind them; where the people stood, the scene is filled in, so nothing tears open when the camera moves. Then, frame
by frame, the scene shifts by its distance (the clip's depth map): far things barely move, near ones swing past, and
the people, a solid layer in front, keep the camera's attention. The result is a short silent video that takes the
frozen moment's place on the timeline.

Drawn on this Mac's GPU (native/freeze_render.swift, Core Image) with the hardware encoder when it can; otherwise on
the CPU here, with the same formula (tests/test_time_freeze.py compares the two).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
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
VERSION = 3  # 2: a narrower fill behind the people. 3: filled by mirroring what is beside it, sharp.
GPU_TOOL = Path(__file__).resolve().parents[2] / 'native' / 'freeze_render.swift'
MOVES = ('orbit-left', 'orbit-right', 'push-in', 'rise')
SWING = 0.05  # How far the camera travels across, as a share of the width, end to end (orbits, rise).
PUSH = 0.14  # How much nearer the camera gets in a push-in (as extra size of what is near).
BASE = 1.05  # Always a little larger, so the frame's edges never show as the scene shifts.
PARALLAX = 2.2  # How much more the near swings past than the far.
FILL = 0.016  # How far around the people (share of the width) the scene is filled in: what the camera's move uncovers.


def target_path(source: Path, at: float, seconds: float, move: str) -> Path:
    ident = json.dumps([VERSION, str(source), source.stat().st_size, round(at, 3), round(seconds, 2), move])
    return settings.data_dir / 'media' / f'freeze3d-{hashlib.sha256(ident.encode()).hexdigest()[:16]}.mp4'


def path(move: str, frames: int) -> list[tuple[float, float, float]]:
    """The camera at each frame: (across, up) as shares of the width, and how far it has pushed in (0..PUSH)."""
    out = []
    for k in range(frames):
        u = k / max(1, frames - 1)
        eased = 0.5 - 0.5 * math.cos(math.pi * u)  # Starts and stops gently, like a crane.
        if move in ('orbit-left', 'orbit-right'):
            sign = 1 if move == 'orbit-right' else -1
            out.append((sign * SWING * (eased - 0.5), 0.0, 0.25 * PUSH * math.sin(math.pi * u)))
        elif move == 'rise':
            out.append((0.0, SWING * (eased - 0.5), 0.2 * PUSH * eased))
        else:  # push-in
            out.append((0.0, 0.0, PUSH * eased))
    return out


def size_at(push: float, near: np.ndarray | float):
    """How much larger something at nearness `near` shows when the camera has pushed in by `push`."""
    return BASE * (1 + push * (0.3 + 1.4 * near))


def view(plate: np.ndarray, frame: np.ndarray, person: np.ndarray, near: np.ndarray, subject: float, camera: tuple[float, float, float]) -> np.ndarray:
    """One frame of the move (CPU): the filled-in scene shifted by distance, the people over it as one layer.
    plate, frame: H×W×3 uint8; person: H×W 0..1; near: H×W 0..1."""
    import cv2
    height, width = frame.shape[:2]
    across, up, push = camera
    cx, cy = (width - 1) / 2, (height - 1) / 2
    xs, ys = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    scale = size_at(push, near).astype(np.float32)
    shift_x, shift_y = across * width * PARALLAX * (near - subject), -up * width * PARALLAX * (near - subject)
    scene = cv2.remap(plate, ((xs - cx - shift_x) / scale + cx).astype(np.float32), ((ys - cy - shift_y) / scale + cy).astype(np.float32),
                      cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    if not person.any():
        return scene
    s = float(size_at(push, subject))
    # The people are the camera's pivot: they stay where they are and only grow as it pushes in.
    map_x, map_y = ((xs - cx) / s + cx).astype(np.float32), ((ys - cy) / s + cy).astype(np.float32)
    people = cv2.remap(frame, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
    alpha = cv2.remap(person.astype(np.float32), map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)[..., None]
    return np.clip(scene.astype(np.float32) * (1 - alpha) + people * alpha + 0.5, 0, 255).astype(np.uint8)


def fill_behind(frame: np.ndarray, person: np.ndarray) -> np.ndarray:
    """The scene with the people taken out and the gap filled. The camera only ever uncovers a thin strip at the
    people's edge, and that strip should carry on what is right beside it: so each row of the gap is filled with the
    row just outside it, mirrored in from both sides (sharp grass stays sharp grass), and a seam, if any, stays in the
    middle, behind the people. Softened a touch across rows so the rows don't show."""
    import cv2
    height, width = frame.shape[:2]
    reach = max(3, round(FILL * width))
    hole = cv2.dilate((person > 0.2).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * reach + 1, 2 * reach + 1))).astype(bool)
    if not hole.any():
        return frame.copy()
    filled = frame.copy()
    for row in np.nonzero(hole.any(axis=1))[0]:
        line = hole[row]
        edges = np.diff(np.concatenate([[0], line.astype(np.int8), [0]]))
        for a, b in zip(np.nonzero(edges == 1)[0], np.nonzero(edges == -1)[0]):  # The gap runs a..b−1.
            run = b - a
            left = run // 2 if b < width else run
            right = run - left if a > 0 else 0
            if a == 0:
                left, right = 0, run
            if left:  # Mirrored from the left of the gap.
                take = np.clip(a - 1 - np.arange(left), 0, width - 1)
                filled[row, a:a + left] = frame[row, take] if a > 0 else frame[row, np.clip(b + np.arange(left), 0, width - 1)]
            if right:  # Mirrored from the right of it.
                take = np.clip(b + np.arange(right)[::-1], 0, width - 1)
                filled[row, b - right:b] = frame[row, take]
    smooth = cv2.GaussianBlur(filled, (1, 0), sigmaX=0.1, sigmaY=max(1.0, height / 720))  # Across rows only.
    soft = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), max(1, reach / 8))[..., None]
    return np.clip(frame * (1 - soft) + smooth * soft + 0.5, 0, 255).astype(np.uint8)


def _frame(facts: MediaFacts, at: float, width: int, height: int) -> np.ndarray:
    raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{at:.3f}', '-i', str(facts.path), '-frames:v', '1',
                          '-vf', f'{colour(facts)},scale={width}:{height}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True).stdout
    if len(raw) < width * height * 3:
        raise ValueError('That moment is past the end of the clip.')
    return np.frombuffer(raw[:width * height * 3], np.uint8).reshape(height, width, 3).copy()


def _nearness(facts: MediaFacts, depth: Path, at: float, width: int, height: int) -> np.ndarray:
    import cv2
    raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{at:.3f}', '-i', str(depth), '-frames:v', '1',
                          '-vf', f'format=gray,scale={width}:{height}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    near = np.frombuffer(raw[:width * height], np.uint8).reshape(height, width).astype(np.float32) / 255 if len(raw) >= width * height else np.full((height, width), 0.5, np.float32)
    return cv2.GaussianBlur(near, (0, 0), max(1, height / 240))  # Soft, so the scene bends rather than tears.


def find_people(frame: np.ndarray) -> np.ndarray:
    """The people in the frame, 0..1 (Apple Vision on this Mac); none when it can't run."""
    import cv2
    from app.services.cutout_service import SOURCE, helper
    height, width = frame.shape[:2]
    small_w = min(1280, width) // 2 * 2
    small_h = max(2, round(height * small_w / width / 2) * 2)
    try:
        tool = helper(SOURCE)
        rgb = cv2.cvtColor(cv2.resize(frame, (small_w, small_h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        out = subprocess.run([str(tool), str(small_w), str(small_h)], input=rgb.tobytes(), capture_output=True, timeout=120).stdout
    except Exception:
        logger.exception('Could not find the people for the time freeze')
        return np.zeros((height, width), np.float32)
    if len(out) < small_w * small_h:
        return np.zeros((height, width), np.float32)
    mask = np.frombuffer(out[:small_w * small_h], np.uint8).reshape(small_h, small_w).astype(np.float32) / 255
    return np.clip(cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR), 0, 1)


def make(facts: MediaFacts, at: float, seconds: float, move: str, on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """`seconds` of the camera moving `move` around the moment `at` (source seconds), as a silent video. Made once."""
    if move not in MOVES:
        raise ValueError('Choose orbit left, orbit right, push in or rise.')
    target = target_path(facts.path, at, seconds, move)
    if target.is_file():
        return target
    depth = make_depth_map(facts, lambda value: on_progress(value // 2), should_cancel)
    width, height = facts.width or 1920, facts.height or 1080
    width, height = width - width % 2, height - height % 2
    fps = facts.fps or 30
    frame = _frame(facts, at, width, height)
    near = _nearness(facts, depth, at, width, height)
    person = find_people(frame)
    plate = fill_behind(frame, person)
    # The camera turns around the people (they stay put while the scene swings behind them), or the middle of the
    # picture when there are none.
    centre = near[height // 3:2 * height // 3, width // 3:2 * width // 3]
    subject = float(np.median(near[person > 0.5])) if (person > 0.5).sum() > 200 else float(np.median(centre))
    cameras = path(move, max(2, round(seconds * fps)))
    on_progress(55)
    if os.environ.get('KANAA_GPU_EFFECTS') != '0':
        try:
            if _make_gpu(plate, frame, person, near, subject, cameras, fps, target, on_progress, should_cancel):
                on_progress(100)
                return target
        except JobCancelled:
            raise
        except Exception:
            logger.exception('GPU time freeze failed; making it on the CPU')
    _make_cpu(plate, frame, person, near, subject, cameras, fps, target, on_progress, should_cancel)
    on_progress(100)
    return target


def _encoder(ffmpeg: str, height: int, hardware: bool) -> list[str]:
    from app.services.lens_service import hardware_encoder
    return hardware_encoder(ffmpeg, height) if hardware else ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16']


def _writer(ffmpeg: str, size: tuple[int, int], fps: float, pix: str, temporary: Path, encoder: list[str], stdin) -> subprocess.Popen:
    return subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', pix, '-s', f'{size[0]}x{size[1]}', '-r', f'{fps}', '-i', '-',
                             *encoder, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)], stdin=stdin, stderr=subprocess.PIPE)


def _make_gpu(plate, frame, person, near, subject, cameras, fps, target: Path, on_progress, should_cancel) -> bool:
    import cv2
    from app.services.cutout_service import helper
    try:
        tool = helper(GPU_TOOL)
    except RuntimeError:
        return False
    ffmpeg = shutil.which('ffmpeg')
    height, width = frame.shape[:2]
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        (root / 'plate.raw').write_bytes(cv2.cvtColor(plate, cv2.COLOR_BGR2BGRA).tobytes())
        (root / 'frame.raw').write_bytes(cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA).tobytes())
        (root / 'person.raw').write_bytes((np.clip(person, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
        (root / 'near.raw').write_bytes((np.clip(near, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
        (root / 'cameras.txt').write_text('\n'.join(f'{a:.6f} {u:.6f} {p:.6f}' for a, u, p in cameras))
        draw = subprocess.Popen([str(tool), str(width), str(height), f'{subject}', f'{BASE}', f'{PARALLAX}', '1' if person.any() else '0', str(root)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        processes = [draw]
        try:
            write = _writer(ffmpeg, (width, height), fps, 'bgra', temporary, _encoder(ffmpeg, height, True), draw.stdout)
            processes.append(write)
            assert draw.stdout and draw.stderr
            draw.stdout.close()
            for line in draw.stderr:
                if should_cancel():
                    raise JobCancelled()
                if line.startswith(b'frame '):
                    on_progress(55 + min(43, int(line.split()[1]) * 43 // len(cameras)))
            if draw.wait() or write.wait() or not temporary.is_file():
                raise RuntimeError(f'freeze_render {draw.returncode}, ffmpeg {write.returncode}: {(write.stderr.read() if write.stderr else b"")[-500:]!r}')
            temporary.replace(target)
            return True
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
            temporary.unlink(missing_ok=True)


def _make_cpu(plate, frame, person, near, subject, cameras, fps, target: Path, on_progress, should_cancel) -> None:
    ffmpeg = shutil.which('ffmpeg')
    height, width = frame.shape[:2]
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    write = _writer(ffmpeg, (width, height), fps, 'bgr24', temporary, _encoder(ffmpeg, height, False), subprocess.PIPE)
    try:
        assert write.stdin
        for k, camera in enumerate(cameras):
            if should_cancel():
                raise JobCancelled()
            write.stdin.write(view(plate, frame, person, near, subject, camera).tobytes())
            if k % 10 == 0:
                on_progress(55 + min(43, k * 43 // len(cameras)))
        write.stdin.close()
        if write.wait():
            raise RuntimeError('Could not make the time freeze.')
        temporary.replace(target)
    finally:
        if write.poll() is None:
            write.kill()
        temporary.unlink(missing_ok=True)
