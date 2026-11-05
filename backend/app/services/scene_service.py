"""Finds where a long recording changes shot, so it can be split into its separate scenes. Runs on this Mac.

Each frame becomes a small colour histogram. A cut is a frame whose colours jump far more than the frames just
before it did: a fixed bar alone would split every fast pan, and a relative one alone every flicker in the dark.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable

import numpy as np

from app.services.job_service import JobCancelled
from app.services.tracking_service import FPS, frames

WORK_SIZE = (96, 54)
BINS = 8  # Per colour channel.
MIN_JUMP = 0.35  # Half the histogram's L1 distance, 0 (same colours) to 1 (none shared).
JUMP_OVER_USUAL = 3.0  # Times the recent average change.
RECENT_FRAMES = 15
MIN_SHOT_SECONDS = 1.0


def histogram(picture: np.ndarray) -> np.ndarray:
    quantised = (picture // (256 // BINS)).astype(np.int32).reshape(-1, 3)
    codes = quantised[:, 0] * BINS * BINS + quantised[:, 1] * BINS + quantised[:, 2]
    counts = np.bincount(codes, minlength=BINS ** 3).astype(np.float32)
    return counts / max(1.0, counts.sum())


def changes(pictures: Iterable[np.ndarray], should_cancel: Callable[[], bool] = lambda: False, on_frame: Callable[[int], None] = lambda _: None) -> list[float]:
    """How much each frame's colours differ from the frame before; the first frame is 0."""
    result: list[float] = []
    previous = None
    for number, picture in enumerate(pictures):
        if should_cancel():
            raise JobCancelled()
        current = histogram(picture)
        result.append(0.0 if previous is None else float(np.abs(current - previous).sum() / 2))
        previous = current
        on_frame(number)
    return result


def cuts_from_changes(differences: list[float], fps: float = FPS) -> list[float]:
    """Seconds where a new shot starts, at least MIN_SHOT_SECONDS apart and from either end."""
    cuts: list[float] = []
    last = 0
    total = len(differences)
    for index in range(1, total):
        jump = differences[index]
        recent = differences[max(1, index - RECENT_FRAMES):index]
        usual = float(np.mean(recent)) if recent else 0.0
        if jump < MIN_JUMP or jump < usual * JUMP_OVER_USUAL:
            continue
        if (index - last) / fps < MIN_SHOT_SECONDS or (total - index) / fps < MIN_SHOT_SECONDS:
            continue
        cuts.append(round(index / fps, 3))
        last = index
    return cuts


def find_scenes(source: Path, start: float, end: float, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> dict:
    """Cuts between `start` and `end`, in source seconds."""
    first = round(start * FPS)
    count = max(1, round((end - start) * FPS))
    step = max(1, count // 100)
    differences = changes(frames(source, first, count, WORK_SIZE), should_cancel, lambda number: on_progress(min(99, number * 100 // count)) if number % step == 0 else None)
    return {'cuts': [round(start + cut, 3) for cut in cuts_from_changes(differences)]}
