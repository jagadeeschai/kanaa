"""Follows a box through a video, so a title, sticker or blur box can move with it. Runs on this Mac."""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Iterator

import numpy as np

from app.services.job_service import JobCancelled

logger = logging.getLogger(__name__)
FPS = 30  # Proxies are 30 frames a second, and so is the path.
WORK_WIDTH = 640  # Big enough to hold a face or a plate, small enough to track in real time.
BACK_CHUNK_SECONDS = 2  # Backwards tracking reads the video in short pieces, newest first.
SMOOTH_FRAMES = 5
MIN_BOX = 0.01


def frames(source: Path, first: int, count: int, size: tuple[int, int]) -> Iterator[np.ndarray]:
    """`count` frames from frame `first`, at 30 a second, as BGR pictures of `size`."""
    width, height = size
    # Seeking a quarter frame early makes the first frame out exactly frame `first`.
    process = subprocess.Popen([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{max(0, (first - 0.25) / FPS):.6f}', '-i', str(source), '-frames:v', str(count),
                                '-vf', f'fps={FPS},scale={width}:{height}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        assert process.stdout is not None
        while frame := process.stdout.read(width * height * 3):
            if len(frame) < width * height * 3:
                break
            yield np.frombuffer(frame, np.uint8).reshape(height, width, 3)
    finally:
        process.kill()
        process.wait()
        if process.stdout is not None:
            process.stdout.close()


def new_tracker():
    import cv2  # Loaded only when tracking, as it is large.
    return cv2.TrackerCSRT_create()


def follow(pictures: Iterator[np.ndarray], box: tuple[float, float, float, float], size: tuple[int, int], should_cancel: Callable[[], bool], on_frame: Callable[[], None]) -> tuple[list[tuple[float, float, float, float]], bool]:
    """Boxes as centre and size, 0 to 1, one per picture. The first is the given box. Stops early when the subject is lost."""
    width, height = size
    tracker = new_tracker()
    boxes: list[tuple[float, float, float, float]] = []
    try:
        for number, picture in enumerate(pictures):
            if should_cancel():
                raise JobCancelled()
            on_frame()
            if number == 0:
                cx, cy, w, h = box
                tracker.init(picture, (round((cx - w / 2) * width), round((cy - h / 2) * height), max(4, round(w * width)), max(4, round(h * height))))
                boxes.append(box)
                continue
            found, (left, top, w, h) = tracker.update(picture)
            cx, cy = (left + w / 2) / width, (top + h / 2) / height
            if not found or not (0 <= cx <= 1 and 0 <= cy <= 1) or w < 2 or h < 2:
                return boxes, True
            boxes.append((cx, cy, w / width, h / height))
        return boxes, False
    finally:
        if hasattr(pictures, 'close'):
            pictures.close()  # Stops reading the video as soon as the subject is lost.


def smooth(boxes: list[tuple[float, float, float, float]], keep: int | None = None) -> list[tuple[float, float, float, float]]:
    """A short centred average takes out the tracker's frame-to-frame shake. Box `keep` is the one the person drew, and stays exactly."""
    if len(boxes) < SMOOTH_FRAMES:
        return boxes
    values = np.array(boxes)
    half = SMOOTH_FRAMES // 2
    padded = np.concatenate([np.repeat(values[:1], half, axis=0), values, np.repeat(values[-1:], half, axis=0)])
    kernel = np.ones(SMOOTH_FRAMES) / SMOOTH_FRAMES
    smoothed = np.stack([np.convolve(padded[:, column], kernel, mode='valid') for column in range(4)], axis=1)
    if keep is not None:
        smoothed[keep] = values[keep]
    return [tuple(row) for row in smoothed.tolist()]


def work_size(source_size: tuple[int, int]) -> tuple[int, int]:
    """The source's shape, with its long side at WORK_WIDTH."""
    w, h = source_size
    return (WORK_WIDTH, max(2, round(WORK_WIDTH * h / w / 2) * 2)) if w >= h else (max(2, round(WORK_WIDTH * w / h / 2) * 2), WORK_WIDTH)


def track(source: Path, source_size: tuple[int, int], at: float, box: tuple[float, float, float, float], start: float, end: float,
          on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> dict:
    """Tracks forward to `end` and back to `start`, all in source seconds. Each point is [seconds, x, y, width, height]."""
    size = work_size(source_size)
    box = (box[0], box[1], max(MIN_BOX, box[2]), max(MIN_BOX, box[3]))
    origin, first, last = round(at * FPS), round(start * FPS), max(round(at * FPS), round(end * FPS) - 1)
    first = min(first, origin)
    total = max(1, last - first + 1)
    done = [0]

    def tick():
        done[0] += 1
        on_progress(min(99, done[0] * 100 // total))

    forward, lost_forward = follow(frames(source, origin, last - origin + 1, size), box, size, should_cancel, tick)
    backward: list[tuple[float, float, float, float]] = [box]
    lost_backward = False
    if first < origin:
        # Read short pieces newest first and play each in reverse, so memory stays small on long clips.
        def reversed_pictures() -> Iterator[np.ndarray]:
            stop = origin + 1
            while stop > first:
                begin = max(first, stop - BACK_CHUNK_SECONDS * FPS)
                yield from reversed(list(frames(source, begin, stop - begin, size)))
                stop = begin

        backward, lost_backward = follow(reversed_pictures(), box, size, should_cancel, tick)
    path = smooth(list(reversed(backward[1:])) + forward, len(backward) - 1)
    begin = origin - (len(backward) - 1)
    points = [[round((begin + index) / FPS, 4), *(round(value, 5) for value in item)] for index, item in enumerate(path)]
    return {'points': points, 'lost_before': lost_backward, 'lost_after': lost_forward}

