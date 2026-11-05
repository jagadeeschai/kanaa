"""Auto-reframe: where the main person is over a clip, so a landscape video can become a vertical reel that follows them.

Uses the face paths from face_service.find_faces (the same finder as Blur faces). At each moment the biggest face on
screen is the subject; the camera then moves smoothly, like an operator, instead of jumping with every head turn.
"""
from __future__ import annotations

import numpy as np

STEP = 0.5  # Seconds between keyframes: few enough to edit by hand, enough to follow a walk.
SMOOTH_SECONDS = 1.5
# The camera holds still while the subject stays this close to where it is pointing (share of the picture).
DEAD_ZONE = 0.04


def subject_path(faces: list[list[list[float]]], start: float, end: float, step: float = STEP) -> list[list[float]]:
    """[[seconds, x, y], …] from `start` to `end` (source seconds), 0 to 1 across the picture. Empty when no face is ever seen."""
    if not faces or end <= start:
        return []
    times = np.arange(start, end + 1e-6, step)
    if times[-1] < end - 1e-3:
        times = np.append(times, end)
    picked: list[tuple[float, float] | None] = []
    for t in times:
        best, area = None, 0.0
        for path in faces:
            # A face's path has a box for every frame from when it is first seen to when it is last seen.
            if not path or not path[0][0] - 1e-6 <= t <= path[-1][0] + 1e-6:
                continue
            row = min(path, key=lambda point: abs(point[0] - t))
            size = row[3] * row[4]
            if size > area:
                best, area = (row[1], row[2]), size
        picked.append(best)
    if not any(picked):
        return []
    # Gaps (a turned head, nobody in frame) hold the nearest place seen, before and after.
    first = next(point for point in picked if point)
    filled, last = [], first
    for point in picked:
        last = point or last
        filled.append(last)
    xs = np.array([point[0] for point in filled]); ys = np.array([point[1] for point in filled])
    reach = max(1, int(round(SMOOTH_SECONDS / step / 2)))
    kernel = np.ones(reach * 2 + 1) / (reach * 2 + 1)

    def smooth(values: np.ndarray) -> np.ndarray:
        padded = np.concatenate([np.full(reach, values[0]), values, np.full(reach, values[-1])])
        return np.convolve(padded, kernel, mode='valid')

    def hold(values: np.ndarray) -> np.ndarray:
        result, aim = [], values[0]
        for value in values:
            if abs(value - aim) > DEAD_ZONE:
                aim = value - np.sign(value - aim) * DEAD_ZONE
            result.append(aim)
        return np.array(result)
    xs, ys = smooth(hold(xs)), smooth(hold(ys))
    return [[round(float(t), 3), round(float(x), 4), round(float(y), 4)] for t, x, y in zip(times, xs, ys)]
