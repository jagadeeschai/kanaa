"""Follows the camera, not one thing: how the whole scene moves from one moment of a clip to every other.

A title locked to the scene uses it to keep its place in the world while the camera pans, tilts or walks. Each step
finds corners in the picture, follows them to the next frame (Lucas-Kanade optical flow) and fits a homography with
RANSAC, which ignores the minority that move on their own, such as a person walking. Steps are chained outward from
the pin moment in both directions and smoothed. The result is in the source's own 0..1 coordinates, so it can be placed
wherever the clip sits on the frame (title3d.scene_matrix). Kept with the clip's other prepared files. Runs on this Mac.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Callable

import numpy as np

from app.services.asset_service import content_key, folder_for
from app.services.job_service import JobCancelled
from app.services.tracking_service import FPS, frames

logger = logging.getLogger(__name__)
WORK_WIDTH = 640
MAX_CORNERS = 500
MIN_MATCHES = 24  # Fewer than this and the step is a guess: hold the last good motion and say so.
SMOOTH_FRAMES = 5
VERSION = 2


def track_path(source: Path, start: float, end: float, at: float, person_mask: Path | None = None) -> Path:
    ident = json.dumps([VERSION, round(start * FPS), round(end * FPS), round(at * FPS), bool(person_mask and person_mask.is_file())])
    return folder_for(content_key(source)) / f'scene-track-{hashlib.sha256(ident.encode()).hexdigest()[:12]}.json'


def _step(previous: np.ndarray, current: np.ndarray, allowed: np.ndarray | None = None) -> tuple[np.ndarray | None, int]:
    """The homography taking the previous picture's pixels to the current one's, and how many points agreed."""
    import cv2
    points = cv2.goodFeaturesToTrack(previous, MAX_CORNERS, 0.01, 8, mask=allowed)
    if points is None or len(points) < MIN_MATCHES:
        return None, 0
    moved, status, _ = cv2.calcOpticalFlowPyrLK(previous, current, points, None, winSize=(21, 21), maxLevel=3)
    good = status.ravel() == 1
    if good.sum() < MIN_MATCHES:
        return None, int(good.sum())
    matrix, inliers = cv2.findHomography(points[good], moved[good], cv2.RANSAC, 2.5)
    count = int(inliers.sum()) if inliers is not None else 0
    return (matrix, count) if matrix is not None and count >= MIN_MATCHES else (None, count)


def _chain(pictures, should_cancel: Callable[[], bool], on_frame: Callable[[], None], masks=None) -> tuple[list[np.ndarray], list[bool]]:
    """Matrices from the first picture to each one, in pixels, and whether each step was found rather than held."""
    out, found, last_step, previous = [np.eye(3)], [True], np.eye(3), None
    mask_iterator = iter(masks) if masks is not None else None
    previous_allowed = None
    for picture in pictures:
        if should_cancel():
            raise JobCancelled()
        on_frame()
        import cv2
        grey = cv2.cvtColor(picture, cv2.COLOR_BGR2GRAY)
        allowed = None
        if mask_iterator is not None:
            mask_picture = next(mask_iterator, None)
            if mask_picture is not None:
                # Person masks are white where a person is. Dilate slightly before inversion so clothing edges and
                # their shadows cannot pull the camera track along with the walker.
                person = cv2.cvtColor(mask_picture, cv2.COLOR_BGR2GRAY)
                person = cv2.dilate((person > 24).astype(np.uint8) * 255, np.ones((7, 7), np.uint8), iterations=1)
                allowed = cv2.bitwise_not(person)
        if previous is not None:
            step, _ = _step(previous, grey, previous_allowed)
            held = step is None
            if held:
                step = last_step  # Lost for a moment: keep moving as the camera was.
            last_step = step
            out.append(step @ out[-1])
            found.append(not held)
        previous = grey
        previous_allowed = allowed
    return out, found


def _smooth(matrices: list[np.ndarray]) -> list[np.ndarray]:
    """Averages where the picture's corners go over a few frames, then fits the matrix again: steadier, same path."""
    import cv2
    square = np.float32([[0, 0], [1, 0], [1, 1], [0, 1]]).reshape(-1, 1, 2)
    paths = np.array([cv2.perspectiveTransform(square, m).reshape(4, 2) for m in matrices])
    half = SMOOTH_FRAMES // 2
    # Mirrored through the end points, so a steady pan stays exactly on its line up to the first and last frame.
    padded = np.concatenate([2 * paths[:1] - paths[half:0:-1], paths, 2 * paths[-1:] - paths[-2:-half - 2:-1]]) if len(paths) > half + 1 else paths
    shift = half if len(paths) > half + 1 else 0
    out = []
    for index in range(len(paths)):
        centre = index + shift
        window = padded[max(0, centre - half):centre + half + 1].mean(axis=0)
        out.append(cv2.getPerspectiveTransform(square.reshape(4, 2), np.float32(window)))
    return out


def scene_track(source: Path, size: tuple[int, int], start: float, end: float, at: float, on_progress: Callable[[int], None] = lambda _: None,
                should_cancel: Callable[[], bool] = lambda: False, person_mask: Path | None = None) -> dict:
    """How the scene moves from `at` to every frame between `start` and `end` (source seconds), in 0..1 coordinates.

    {'fps', 'first' (frame number of the first matrix), 'matrices' (3x3, the at moment is the identity), 'lost' (frames held)}."""
    width = WORK_WIDTH
    height = max(2, round(size[1] * width / max(1, size[0]) / 2) * 2)
    first, anchor, last = round(start * FPS), round(at * FPS), round(end * FPS)
    total = max(1, last - first)
    done = [0]

    def tick():
        done[0] += 1
        on_progress(min(99, done[0] * 100 // total))
    mask_source = person_mask if person_mask and person_mask.is_file() else None
    forward_masks = frames(mask_source, anchor, last - anchor + 1, (width, height)) if mask_source else None
    forward, found_forward = _chain(frames(source, anchor, last - anchor + 1, (width, height)), should_cancel, tick, forward_masks)
    backward_pictures = list(frames(source, first, anchor - first + 1, (width, height)))[::-1] if anchor > first else []
    backward_masks = list(frames(mask_source, first, anchor - first + 1, (width, height)))[::-1] if mask_source and anchor > first else None
    backward, found_backward = _chain(iter(backward_pictures), should_cancel, tick, backward_masks) if backward_pictures else ([np.eye(3)], [True])
    # In pixels of the work size, from the anchor frame; the backward chain is reversed back into time order.
    matrices = [*backward[:0:-1], *forward]
    lost = [not ok for ok in [*found_backward[:0:-1], *found_forward]]
    matrices = _smooth(matrices)
    scale, unscale = np.diag([1 / width, 1 / height, 1]), np.diag([width, height, 1])
    normal = [(scale @ m @ unscale) / (scale @ m @ unscale)[2, 2] for m in matrices]
    on_progress(100)
    return {'fps': FPS, 'first': anchor - (len(backward) - 1), 'matrices': [np.round(m, 7).tolist() for m in normal], 'lost': [i for i, held in enumerate(lost) if held]}


def ensure(source: Path, size: tuple[int, int], start: float, end: float, at: float, should_cancel: Callable[[], bool] = lambda: False,
           on_progress: Callable[[int], None] = lambda _: None, person_mask: Path | None = None) -> dict:
    target = track_path(source, start, end, at, person_mask)
    if target.is_file():
        return json.loads(target.read_text())
    result = scene_track(source, size, start, end, at, on_progress, should_cancel, person_mask)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result))
    return result


def matrix_at(track: dict, source_seconds: float) -> list[list[float]]:
    """The track's matrix at a moment, held at the ends. Shared rule with matrixAt in title3d.ts."""
    index = min(len(track['matrices']) - 1, max(0, round(source_seconds * track['fps']) - track['first']))
    return track['matrices'][index]
