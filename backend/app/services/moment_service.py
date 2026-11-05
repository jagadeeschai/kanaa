"""Best moments: the stretch of a clip worth keeping, for story templates, instead of always its middle.

Each sampled frame is scored for what makes a shot usable: sharp (not blurred by movement or focus), well exposed,
a steady camera, and people's faces when the face finder is on this Mac. The best-scoring stretch of the length
needed wins. Runs on this Mac, on a small copy of each frame.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from app.services.job_service import JobCancelled

SAMPLES_PER_SECOND = 5
WORK_SIZE = (192, 108)
EDGE_SECONDS = 0.3  # The very start and end of a phone clip are often the hand pressing record.
WEIGHTS = {'sharp': 1.0, 'exposure': 0.6, 'steady': 0.8, 'faces': 0.8}


def sample_frames(source: Path, start: float, end: float, size=WORK_SIZE):
    width, height = size
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-ss', f'{start:.3f}', '-i', str(source), '-t', f'{end - start:.3f}',
                                '-vf', f'fps={SAMPLES_PER_SECOND},scale={width}:{height}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        assert process.stdout is not None
        while frame := process.stdout.read(width * height * 3):
            if len(frame) < width * height * 3:
                break
            yield np.frombuffer(frame, np.uint8).reshape(height, width, 3)
    finally:
        process.kill(); process.wait()
        if process.stdout is not None:
            process.stdout.close()


def frame_scores(pictures, detect: Optional[Callable[[np.ndarray], list]] = None, should_cancel: Callable[[], bool] = lambda: False) -> list[float]:
    """One score per frame, 0 (unusable) to about 1 per quality, each scaled against the clip's own best."""
    sharp, exposure, shake, faces = [], [], [], []
    previous = None
    for picture in pictures:
        if should_cancel():
            raise JobCancelled()
        gray = picture.mean(axis=2)
        # Sharpness: how much the picture changes from one pixel to the next (a Laplacian, without OpenCV).
        lap = gray[1:-1, 1:-1] * 4 - gray[:-2, 1:-1] - gray[2:, 1:-1] - gray[1:-1, :-2] - gray[1:-1, 2:]
        sharp.append(float(lap.var()))
        level = float(gray.mean())
        exposure.append(1.0 - min(1.0, abs(level - 120) / 100))  # Too dark or blown out scores low.
        shake.append(0.0 if previous is None else float(np.abs(gray - previous).mean()))
        previous = gray
        found = detect(picture) if detect else []
        faces.append(sum(w * h for (_, _, w, h), _ in found) ** 0.5 if found else 0.0)
    if not sharp:
        return []
    if len(shake) > 1:
        shake[0] = shake[1]
    best_sharp = max(sharp) or 1.0
    best_face = max(faces) or 1.0
    # Shake past a gentle pan counts against the frame; the clip's own typical movement is the yardstick.
    calm = float(np.median(shake)) + 1.0
    return [WEIGHTS['sharp'] * s / best_sharp + WEIGHTS['exposure'] * e + WEIGHTS['steady'] * max(0.0, 1 - max(0.0, m - calm) / (calm * 3)) + WEIGHTS['faces'] * f / best_face
            for s, e, m, f in zip(sharp, exposure, shake, faces)]


def best_start(scores: list[float], available: float, length: float, offset: float = 0.0) -> float:
    """The start (seconds into the sampled stretch, plus `offset`) of the best-scoring `length`. The middle when it all scores alike."""
    if length >= available or not scores:
        return round(offset + max(0.0, (available - length) / 2), 3)
    window = max(1, round(length * SAMPLES_PER_SECOND))
    sums = np.convolve(np.array(scores), np.ones(window), mode='valid') / window
    if not len(sums):
        return round(offset + (available - length) / 2, 3)
    middle = (len(sums) - 1) / 2
    # Ties go to the stretch nearest the middle, the old choice.
    best = max(range(len(sums)), key=lambda index: (round(float(sums[index]), 3), -abs(index - middle)))
    start = min(best / SAMPLES_PER_SECOND, available - length)
    return round(offset + max(0.0, start), 3)


def find_best(source: Path, duration: float, length: float, detect=None, should_cancel: Callable[[], bool] = lambda: False) -> float:
    """Where the best `length` seconds of a `duration`-second video start."""
    if duration <= length:
        return 0.0
    edge = EDGE_SECONDS if duration - 2 * EDGE_SECONDS > length else 0.0
    scores = frame_scores(sample_frames(source, edge, duration - edge), detect, should_cancel)
    return best_start(scores, duration - 2 * edge, length, edge)
