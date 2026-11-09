"""Follows the camera, not one thing: how the whole scene moves from one moment of a clip to every other.

A title locked to the scene uses it to keep its place in the world while the camera pans, tilts or walks. Each step
finds corners in the picture, follows them to the next frame (Lucas-Kanade optical flow) and fits a homography with
RANSAC, which ignores the minority that move on their own, such as a person walking. Steps are chained outward from
the pin moment in both directions and smoothed. The result is in the source's own 0..1 coordinates, so it can be placed
wherever the clip sits on the frame (title3d.scene_matrix). Kept with the clip's other prepared files. Runs on this Mac.

On the skyline (a title with Sky only in front of it): a billboard on the horizon. A homography fitted to the whole
picture follows the ground near the camera, which on a walking shot squashes and shears the title as if it were painted
on the ground, and any track chained over hundreds of frames drifts. So the skyline track follows only how the camera
pans and turns (never squashed, sheared or zoomed, as a far-off billboard keeps its size), from corners in a band around the horizon (the distant
scene), and then each frame's skyline, found as Sky only finds it (sky_service.find_sky), puts the pin moment's skyline
back onto this frame's: the height and tilt cannot drift.
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


HORIZON_BAND = 0.15  # Corners within this share of the height of the skyline: the distant scene the camera turns past.
HORIZON_SMOOTH_FRAMES = 15  # The skyline is steadied over about half a second (median, then mean).
HORIZON_OUTLIER = 0.012  # Points this far (share of the height) above the fitted skyline are heads, trees or masts.
MIN_SKY_COLUMNS = 0.35  # A skyline fitted from fewer of the columns is a guess: the frame borrows its neighbours' line.


def track_path(source: Path, start: float, end: float, at: float, person_mask: Path | None = None, horizon: bool = False) -> Path:
    ident = json.dumps([VERSION, round(start * FPS), round(end * FPS), round(at * FPS), bool(person_mask and person_mask.is_file())] + (['horizon'] if horizon else []))
    return folder_for(content_key(source)) / f'scene-track-{hashlib.sha256(ident.encode()).hexdigest()[:12]}.json'


def skyline(bgr: np.ndarray) -> tuple[float, float] | None:
    """Where the sky ends, as a straight line y = a + b*x (shares of the frame), or None when too little of it shows.

    Each column's first row that is not sky, fitted again and again without the points well above the line: a head,
    a tree or a mast rising into the sky does not lift the horizon."""
    from app.services.sky_service import find_sky
    sky = find_sky(bgr)
    height, width = sky.shape
    open_columns = ~sky.all(axis=0) & sky[0]
    if open_columns.mean() < MIN_SKY_COLUMNS:
        return None
    columns = np.nonzero(open_columns)[0]
    xs, ys = (columns + 0.5) / width, np.argmin(sky[:, columns], axis=0) / height
    keep = np.ones(len(xs), bool)
    for _ in range(6):
        if keep.sum() < len(xs) * MIN_SKY_COLUMNS:
            return None
        b, a = np.polyfit(xs[keep], ys[keep], 1)
        keep = ys - (a + b * xs) > -HORIZON_OUTLIER
    return float(a), float(b)


def _steady_lines(lines: list[tuple[float, float] | None]) -> list[tuple[float, float]] | None:
    """Gaps filled from the neighbours, then a median and a mean over HORIZON_SMOOTH_FRAMES. None when there is no sky."""
    known = [index for index, line in enumerate(lines) if line is not None]
    if len(known) < max(2, len(lines) // 2):
        return None
    every = np.arange(len(lines))
    columns = [np.interp(every, known, [lines[index][part] for index in known]) for part in (0, 1)]
    half = HORIZON_SMOOTH_FRAMES // 2
    out = []
    for values in columns:
        padded = np.pad(values, half, mode='edge')
        median = np.array([np.median(padded[index:index + 2 * half + 1]) for index in range(len(values))])
        padded = np.pad(median, half, mode='edge')
        out.append(np.convolve(padded, np.ones(2 * half + 1) / (2 * half + 1), 'valid'))
    return list(zip(out[0].tolist(), out[1].tolist()))


def _band(shape: tuple[int, int], line: tuple[float, float] | None) -> np.ndarray | None:
    """White within HORIZON_BAND of the skyline: where the distant scene is."""
    if line is None:
        return None
    height, width = shape
    a, b = line
    rows = np.arange(height)[:, None] / height
    edge = a + b * (np.arange(width)[None, :] + 0.5) / width
    return (np.abs(rows - edge) < HORIZON_BAND).astype(np.uint8) * 255


def _on_skyline(matrix: np.ndarray, anchor: tuple[float, float], line: tuple[float, float], width: int, height: int) -> np.ndarray:
    """The camera's motion turned and lifted so the pin moment's skyline lands on this frame's (in work pixels)."""
    a0, b0 = anchor
    a1, b1 = line
    pivot = matrix @ np.array([width / 2, (a0 + b0 * 0.5) * height, 1.0])
    px, py = pivot[0] / pivot[2], pivot[1] / pivot[2]
    carried = np.arctan2(matrix[1, 0], matrix[0, 0]) + np.arctan2(b0 * height, width)
    turn = np.arctan2(b1 * height, width) - carried
    cos, sin = np.cos(turn), np.sin(turn)
    about = np.array([[cos, -sin, px - cos * px + sin * py], [sin, cos, py - sin * px - cos * py], [0, 0, 1]])
    lift = (a1 + b1 * px / width) * height - py
    return np.array([[1, 0, 0], [0, 1, lift], [0, 0, 1]]) @ about @ matrix


def _step(previous: np.ndarray, current: np.ndarray, allowed: np.ndarray | None = None, upright: bool = False) -> tuple[np.ndarray | None, int]:
    """The homography taking the previous picture's pixels to the current one's, and how many points agreed.
    Upright: only a pan and a turn, at the same size, so nothing drawn with it is ever squashed, sheared or blown up."""
    import cv2
    points = cv2.goodFeaturesToTrack(previous, MAX_CORNERS, 0.01, 8, mask=allowed)
    if points is None or len(points) < MIN_MATCHES:
        return None, 0
    moved, status, _ = cv2.calcOpticalFlowPyrLK(previous, current, points, None, winSize=(21, 21), maxLevel=3)
    good = status.ravel() == 1
    if good.sum() < MIN_MATCHES:
        return None, int(good.sum())
    if upright:
        affine, inliers = cv2.estimateAffinePartial2D(points[good], moved[good], method=cv2.RANSAC, ransacReprojThreshold=2.5)
        if affine is not None:
            # The distant scene keeps its size as the camera walks; a zoom found here is the near ground creeping in.
            # It is taken out about the middle of the agreeing points, so their pan stays as found.
            agreed = inliers.ravel() == 1
            before, after = points[good][agreed].reshape(-1, 2).mean(axis=0), moved[good][agreed].reshape(-1, 2).mean(axis=0)
            affine[:, :2] /= np.sqrt(abs(np.linalg.det(affine[:, :2]))) or 1
            affine[:, 2] = after - affine[:, :2] @ before
        matrix = None if affine is None else np.vstack([affine, [0, 0, 1]])
    else:
        matrix, inliers = cv2.findHomography(points[good], moved[good], cv2.RANSAC, 2.5)
    count = int(inliers.sum()) if inliers is not None else 0
    return (matrix, count) if matrix is not None and count >= MIN_MATCHES else (None, count)


def _chain(pictures, should_cancel: Callable[[], bool], on_frame: Callable[[], None], masks=None, lines: list | None = None) -> tuple[list[np.ndarray], list[bool]]:
    """Matrices from the first picture to each one, in pixels, and whether each step was found rather than held.
    With `lines` (a list to fill: each picture's skyline), the skyline track: upright steps from the band around it."""
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
        if lines is not None:
            lines.append(skyline(picture))
            band = _band(grey.shape, lines[-1] if lines[-1] is not None else next((line for line in reversed(lines) if line is not None), None))
            if band is not None:
                allowed = band if allowed is None else cv2.bitwise_and(allowed, band)
        if previous is not None:
            step, _ = _step(previous, grey, previous_allowed, upright=lines is not None)
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
                should_cancel: Callable[[], bool] = lambda: False, person_mask: Path | None = None, horizon: bool = False) -> dict:
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
    lines_forward, lines_backward = ([], []) if horizon else (None, None)
    forward, found_forward = _chain(frames(source, anchor, last - anchor + 1, (width, height)), should_cancel, tick, forward_masks, lines_forward)
    backward_pictures = list(frames(source, first, anchor - first + 1, (width, height)))[::-1] if anchor > first else []
    backward_masks = list(frames(mask_source, first, anchor - first + 1, (width, height)))[::-1] if mask_source and anchor > first else None
    backward, found_backward = _chain(iter(backward_pictures), should_cancel, tick, backward_masks, lines_backward) if backward_pictures else ([np.eye(3)], [True])
    # In pixels of the work size, from the anchor frame; the backward chain is reversed back into time order.
    matrices = [*backward[:0:-1], *forward]
    lost = [not ok for ok in [*found_backward[:0:-1], *found_forward]]
    matrices = _smooth(matrices)
    if horizon:
        lines = _steady_lines([*(lines_backward or [None])[:0:-1], *lines_forward]) if lines_forward else None
        if lines is not None:
            anchor_index = len(backward) - 1
            matrices = [_on_skyline(matrix, lines[anchor_index], line, width, height) for matrix, line in zip(matrices, lines)]
    scale, unscale = np.diag([1 / width, 1 / height, 1]), np.diag([width, height, 1])
    normal = [(scale @ m @ unscale) / (scale @ m @ unscale)[2, 2] for m in matrices]
    on_progress(100)
    return {'fps': FPS, 'first': anchor - (len(backward) - 1), 'matrices': [np.round(m, 7).tolist() for m in normal], 'lost': [i for i, held in enumerate(lost) if held]}


def ensure(source: Path, size: tuple[int, int], start: float, end: float, at: float, should_cancel: Callable[[], bool] = lambda: False,
           on_progress: Callable[[int], None] = lambda _: None, person_mask: Path | None = None, horizon: bool = False) -> dict:
    target = track_path(source, start, end, at, person_mask, horizon)
    if target.is_file():
        return json.loads(target.read_text())
    result = scene_track(source, size, start, end, at, on_progress, should_cancel, person_mask, horizon)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result))
    return result


def matrix_at(track: dict, source_seconds: float) -> list[list[float]]:
    """The track's matrix at a moment, held at the ends. Shared rule with matrixAt in title3d.ts."""
    index = min(len(track['matrices']) - 1, max(0, round(source_seconds * track['fps']) - track['first']))
    return track['matrices'][index]
