"""Place in depth: how near each pixel of a clip is, every frame (Depth Anything V2 Small, on this Mac), so a title can
sit at a depth with everything nearer than it in front: people, walls, trees, buildings, whatever they are.

The clip's depth is worked out once, as a grey video (white is near), then any "nearer than" level is a quick threshold
of it, so moving the slider doesn't redo the slow part. To keep the slow part quick enough for whole clips, the model
reads a small copy of every third frame; the frames between blend their neighbours, and every frame's depth is
sharpened against that frame's own picture (a guided filter), so edges hug the real outlines as things move.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.services import depth_motion_service
from app.services.cutout_service import EDGE_SOFTNESS, colour, mask_size
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

logger = logging.getLogger(__name__)

VERSION = 2  # 2: levels spread by how much of the picture is at each distance.
WORK_WIDTH = 640  # Depth is sharpened at this width, then scaled to the mask size.
MODEL_SHORT = 266  # The model reads this many pixels on the short side (multiple of its 14-pixel patches): about 0.2 s a frame.
EVERY = 3  # The model reads every third frame at 30 fps (about ten a second at any rate); the ones between blend.
READS_PER_SECOND = 10
RANGE_EASE = 0.15  # How fast the near/far range follows the scene, a frame: steady, so levels don't flicker.
GUIDE_RADIUS, GUIDE_EPS = 8, 1e-3
SHARES = np.linspace(0, 1, 65, dtype=np.float32)  # The share table's steps.
SOFT = 0.04  # A depth level's edge: this much nearness from fully behind to fully in front.

_session = None


def available() -> bool:
    return depth_motion_service.available()


def map_path(source: Path) -> Path:
    from app.services.asset_service import content_key, folder_for
    return folder_for(content_key(source)) / f'depth-map-{VERSION}.mp4'


def _raw(rgb: np.ndarray) -> np.ndarray:
    """The model's own output for a picture: larger is nearer, on no fixed scale."""
    global _session
    import cv2
    import onnxruntime
    if _session is None:
        if not depth_motion_service.MODEL.is_file():
            raise RuntimeError('Place in depth needs the depth model, which is not on this Mac.')
        # The plain CPU is quicker than CoreML for this model at this size.
        _session = onnxruntime.InferenceSession(str(depth_motion_service.MODEL), providers=['CPUExecutionProvider'])
    height, width = rgb.shape[:2]
    scale = MODEL_SHORT / min(height, width)
    w, h = max(14, round(width * scale / 14) * 14), max(14, round(height * scale / 14) * 14)
    x = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    return _session.run(None, {'pixel_values': x.transpose(2, 0, 1)[None]})[0][0].astype(np.float32)


class DepthStream:
    """Frames in (BGR at work size), nearness out (0 far to 1 near, same size): the model on every EVERY-th frame,
    blended between, spread by share of the picture, sharpened against each frame."""

    def __init__(self, model: Callable[[np.ndarray], np.ndarray] = _raw, every: int = EVERY):
        import cv2
        self.cv2, self.model, self.every = cv2, model, max(1, every)
        self.waiting: list[np.ndarray] = []  # Frames since the last model reading.
        self.last: np.ndarray | None = None
        self.table = None

    def _read(self, frame: np.ndarray) -> np.ndarray:
        out = self.model(self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB))
        # Spread by share of the picture: nearness 0.4 means 40% of the picture is further away. The raw scale gives
        # most of its range to the ground at the camera, squeezing trees, hills and buildings together near "far".
        # The share table follows the clip smoothly, so a level doesn't flicker as the camera moves.
        table = np.percentile(out, SHARES * 100).astype(np.float32)
        self.table = table if self.table is None else self.table + (table - self.table) * min(1, RANGE_EASE * self.every)
        steady = np.maximum.accumulate(self.table)
        near = np.interp(out.ravel(), steady + np.arange(steady.size) * 1e-6, SHARES).reshape(out.shape).astype(np.float32)
        return self.cv2.resize(near, (frame.shape[1], frame.shape[0]), interpolation=self.cv2.INTER_LINEAR)

    def _sharp(self, frame: np.ndarray, near: np.ndarray) -> np.ndarray:
        guide = self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        return np.clip(self.cv2.ximgproc.guidedFilter(guide, near.astype(np.float32), GUIDE_RADIUS, GUIDE_EPS), 0, 1)

    def push(self, frame: np.ndarray) -> list[np.ndarray]:
        if self.last is None:
            self.last = self._read(frame)
            return [self._sharp(frame, self.last)]
        self.waiting.append(frame)
        if len(self.waiting) < self.every:
            return []
        reading = self._read(frame)
        out = [self._sharp(each, self.last + (reading - self.last) * (k + 1) / self.every) for k, each in enumerate(self.waiting)]
        self.last, self.waiting = reading, []
        return out

    def finish(self) -> list[np.ndarray]:
        out = [self._sharp(each, self.last) for each in self.waiting]
        self.waiting = []
        return out


def make_depth_map(facts: MediaFacts, on_progress: Callable[[int], None], should_cancel: Callable[[], bool], model: Callable[[np.ndarray], np.ndarray] = _raw) -> Path:
    """The clip's nearness as a grey video at the mask size, frame for frame. Made once."""
    import cv2
    target = map_path(facts.path)
    if target.is_file():
        return target
    width, height = mask_size(facts)
    work_h = max(2, round(height * WORK_WIDTH / width / 2) * 2)
    fps = facts.fps or 30
    total = max(1, round((facts.duration or 1) * fps))
    ffmpeg = shutil.which('ffmpeg')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    decode = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={WORK_WIDTH}:{work_h}', '-fps_mode', 'passthrough',
                               '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    encode = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                               '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', str(temporary)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    stream = DepthStream(model, every=max(1, round(fps / READS_PER_SECOND)))

    def send(maps):
        for near in maps:
            encode.stdin.write(cv2.resize((near * 255).astype(np.uint8), (width, height), interpolation=cv2.INTER_LINEAR).tobytes())
    try:
        done, size = 0, WORK_WIDTH * work_h * 3
        assert decode.stdout is not None and encode.stdin is not None
        while chunk := decode.stdout.read(size):
            if should_cancel():
                raise JobCancelled()
            if len(chunk) < size:
                break
            send(stream.push(np.frombuffer(chunk, np.uint8).reshape(work_h, WORK_WIDTH, 3)))
            done += 1
            if done % 10 == 0:
                on_progress(min(95, done * 95 // total))
        send(stream.finish())
        encode.stdin.close()
        if encode.wait() or done == 0:
            logger.error('Depth failed for %s: %s', facts.path, encode.stderr.read()[-800:] if encode.stderr else '')
            raise RuntimeError('Could not work out the depth of this clip.')
        temporary.replace(target)
    finally:
        for process in (decode, encode):
            if process.poll() is None:
                process.kill()
        temporary.unlink(missing_ok=True)
    return target


def level_filter(near: float) -> str:
    """The grey depth map to a mask: white where nearer than `near`, with a soft edge."""
    low, high = max(0.0, near - SOFT / 2) * 255, min(1.0, near + SOFT / 2) * 255
    return f"lut=y='clip((val-{low:.2f})*255/{max(1.0, high - low):.2f},0,255)',gblur=sigma={EDGE_SOFTNESS}"


def make_depth_mask(facts: MediaFacts, near: float, target: Path, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> None:
    """The mask of everything nearer than `near` (0 far to 1 near), from the clip's depth map."""
    depth = make_depth_map(facts, lambda value: on_progress(value * 9 // 10), should_cancel)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    made = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(depth), '-vf', f'format=gray,{level_filter(near)}',
                           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', str(temporary)], capture_output=True, text=True)
    if made.returncode:
        temporary.unlink(missing_ok=True)
        raise RuntimeError('Could not make the depth mask.')
    temporary.replace(target)
    on_progress(100)


SKY_LEVEL = 0.25  # Behind the scene: what is nearer than this is land (hills, trees, buildings); the rest is sky.


def skyline(facts: MediaFacts, times: list[float], x0: float, x1: float, level: float = SKY_LEVEL) -> list[float | None]:
    """Where the land meets the sky between x0 and x1 (shares of the picture), at each of `times` (source seconds), as
    a share of the picture's height; None where no sky is seen above the land. From the clip's depth map: in each
    column, the first row from the top that is land, then the middle of the columns. Smoothed over time."""
    depth = make_depth_map(facts, lambda _: None, lambda: False)
    found: list[float | None] = []
    for at in times:
        raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{max(0.0, at):.3f}', '-i', str(depth), '-frames:v', '1',
                              '-vf', 'format=gray,scale=320:180', '-f', 'rawvideo', '-'], capture_output=True).stdout
        if len(raw) < 320 * 180:
            found.append(None); continue
        near = np.frombuffer(raw[:320 * 180], np.uint8).reshape(180, 320) / 255
        columns = near[:, max(0, int(x0 * 320)):max(int(x0 * 320) + 1, min(320, int(x1 * 320)))]
        land = columns >= level
        rows = [int(np.argmax(column)) for column in land.T if column.any() and column[:3].mean() < 0.5]  # Sky above, then land.
        found.append(float(np.median(rows) / 180) if len(rows) >= max(3, columns.shape[1] // 4) else None)
    # A step of noise isn't the horizon: each point takes the middle of itself and its neighbours.
    steady = []
    for index in range(len(found)):
        near_ones = [value for value in found[max(0, index - 1):index + 2] if value is not None]
        steady.append(float(np.median(near_ones)) if near_ones else None)
    return steady
