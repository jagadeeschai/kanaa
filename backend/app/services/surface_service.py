"""How a surface in a picture faces the camera, from one click: the tilt a title needs to lie on it.

Straight edges on a surface (window rows, bricks, tiles, kerbs, paving) run in two directions that meet, far away, at
two vanishing points. Lines are found around the click (OpenCV's line segment detector), sorted into the two strongest
directions, and each direction's vanishing point is the point all its lines come closest to passing through (least
squares). Seen from the camera, a direction in the world shows its vanishing point at focal x (dx/dz, dy/dz) from
where the title sits, as title3d.corners projects about the title's own middle with the same FOV; so the two vanishing
points give the surface's two directions in 3D, their cross product its facing, and from those the title's pose:
turn (in the picture), tilt_y (Turn) and tilt_x (Lean back), solved in that order as title3d.corners applies them.

The more horizontal of the two directions becomes the title's line of writing. A click on sky, or where there are too
few straight edges to trust, gives `kind` 'sky' or 'flat' and no tilt: an upright title that follows the scene.
"""
from __future__ import annotations

import math

import numpy as np

from app.services.title3d import FOV

WORK_WIDTH = 960
REACH = 0.22  # Lines are looked for within this share of the picture's width of the click.
MIN_LENGTH = 0.02  # Of the work width: shorter segments are texture, not edges.
FAMILY_SPREAD = 9.0  # Degrees either side of a direction's peak that still count as that direction.
MIN_APART = 25.0  # Degrees: the two directions must differ by at least this much.
MIN_LINES = 3  # Per direction.
MAX_TILT = 75.0


def _directions(segments: np.ndarray, count: int = 4) -> list[tuple[float, np.ndarray]]:
    """Up to `count` strong directions (degrees 0..180, length-weighted) and their segments, strongest first."""
    dx, dy = segments[:, 2] - segments[:, 0], segments[:, 3] - segments[:, 1]
    angle = np.degrees(np.arctan2(dy, dx)) % 180
    length = np.hypot(dx, dy)
    bins = np.zeros(180)
    for a, w in zip(angle, length):
        for spread in range(-3, 4):  # A little smoothing, around the circle of directions.
            bins[int(round(a + spread)) % 180] += w * (1 - abs(spread) / 4)
    found = []
    for _ in range(count):
        peak = int(np.argmax(bins))
        if bins[peak] <= 0:
            break
        gap = np.abs((angle - peak + 90) % 180 - 90)
        family = segments[gap <= FAMILY_SPREAD]
        if len(family) >= MIN_LINES:
            found.append((float(peak), family))
        for offset in range(-int(MIN_APART), int(MIN_APART) + 1):
            bins[(peak + offset) % 180] = 0
    return found


def _from_horizontal(angle: float) -> float:
    return min(angle % 180, 180 - angle % 180)


def _vanishing(lines: np.ndarray, centre: tuple[float, float]) -> np.ndarray:
    """The point the lines all come closest to passing through, as (X, Y, W) about `centre`; W near 0 when they are parallel."""
    cx, cy = centre
    rows = []
    for x0, y0, x1, y1 in lines:
        a = np.array([x0 - cx, y0 - cy, 1.0]); b = np.array([x1 - cx, y1 - cy, 1.0])
        line = np.cross(a, b)
        line /= np.hypot(line[0], line[1]) or 1
        rows.append(line * math.hypot(x1 - x0, y1 - y0))  # Long edges count for more.
    _, _, vt = np.linalg.svd(np.array(rows))
    return vt[-1]


def _pose(u: np.ndarray, n: np.ndarray) -> dict:
    """turn, tilt_y and tilt_x (degrees) putting the title's line of writing along `u` on a plane facing `n`
    (both in camera space: x right, y down, z away), undoing title3d.corners: turn, then tilt_y, then tilt_x."""
    n = n / np.linalg.norm(n)
    if n[2] < 0:
        n = -n  # A plane the camera sees faces it; the title's own back points away, +z, as at rest.
    b = math.asin(max(-1.0, min(1.0, -n[0])))
    a = math.atan2(n[1], n[2])
    ca, sa, cb, sb = math.cos(a), math.sin(a), math.cos(b), math.sin(b)
    e1 = np.array([cb, sb * sa, sb * ca])  # Where the title's x and y axes go after Turn and Lean back.
    e2 = np.array([0.0, ca, -sa])
    u = u - n * (u @ n)
    turn = math.atan2(u @ e2, u @ e1)
    # Writing reads left to right: never upside down.
    if abs(turn) > math.pi / 2:
        turn -= math.copysign(math.pi, turn)
    return {'turn': math.degrees(turn), 'tilt_y': math.degrees(b), 'tilt_x': math.degrees(a)}


# Without enough lines of the right kind, a surface of each kind gets this pose (tilt_x leans the top away).
DEFAULTS = {'floor': {'turn': 0.0, 'tilt_x': 62.0, 'tilt_y': 0.0}, 'wall': {'turn': 0.0, 'tilt_x': 0.0, 'tilt_y': 0.0},
            'upright': {'turn': 0.0, 'tilt_x': 0.0, 'tilt_y': 0.0}, 'sky': {'turn': 0.0, 'tilt_x': 0.0, 'tilt_y': 0.0}}
KINDS = tuple(DEFAULTS)


def surface_at(bgr: np.ndarray, x: float, y: float, sky: np.ndarray | None = None, kind: str | None = None) -> dict:
    """The surface under (x, y), guessing its kind when none is given: sky where sky is; otherwise a floor or a wall,
    whichever its lines support, trying a floor first low in the picture and a wall first higher up; else upright."""
    if kind is None:
        if sky is not None:
            sy, sx = min(sky.shape[0] - 1, int(y * sky.shape[0])), min(sky.shape[1] - 1, int(x * sky.shape[1]))
            if sky[sy, sx]:
                return {'kind': 'sky', **DEFAULTS['sky'], 'found': False, 'lines': 0}
        for guess in (('floor', 'wall') if y >= 0.55 else ('wall', 'floor')):
            found = _surface(bgr, x, y, guess)
            if found['found']:
                return found
        return {**_surface(bgr, x, y, 'upright'), 'lines': found['lines']}
    return _surface(bgr, x, y, kind)


def _surface(bgr: np.ndarray, x: float, y: float, kind: str | None) -> dict:
    """The surface under (x, y), shares of the picture: {'kind', 'turn', 'tilt_x', 'tilt_y', 'found', 'lines'}.

    kind: what the person says it is, 'floor', 'wall', 'upright' or 'sky'; none to guess. Only lines that fit that kind
    are used: on a floor, the line of writing runs across the picture and the other lines run away from the camera
    (steep in the picture); on a wall, upright lines stand for the world's vertical and the line of writing is the
    other strong direction. Upright and sky are never tilted. found: whether the pose came from the picture (else it is
    the kind's default)."""
    import cv2
    height, width = bgr.shape[:2]
    scale = WORK_WIDTH / width
    picture = cv2.resize(bgr, (WORK_WIDTH, max(2, round(height * scale)))) if scale != 1 else bgr
    h, w = picture.shape[:2]
    px, py = x * w, y * h
    default = lambda chosen, lines=0: {'kind': chosen, **DEFAULTS[chosen], 'found': False, 'lines': lines}
    if kind in ('upright', 'sky'):
        return default(kind)
    reach = REACH * w
    x0, x1 = int(max(0, px - reach)), int(min(w, px + reach))
    y0, y1 = int(max(0, py - reach)), int(min(h, py + reach))
    grey = cv2.cvtColor(picture[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    detected = cv2.createLineSegmentDetector().detect(grey)[0]
    segments = np.zeros((0, 4)) if detected is None else detected.reshape(-1, 4) + np.array([x0, y0, x0, y0])
    segments = segments[np.hypot(segments[:, 2] - segments[:, 0], segments[:, 3] - segments[:, 1]) >= MIN_LENGTH * w]
    families = _directions(segments) if len(segments) else []
    fallback = kind or 'upright'
    focal = (h / 2) / math.tan(math.radians(FOV / 2))

    def direction(family: np.ndarray) -> np.ndarray:
        X, Y, W = _vanishing(family, (px, py))
        d = np.array([X, Y, W * focal])
        return d / np.linalg.norm(d)

    # Which two directions: the line of writing (u) and the one that, with it, spans the surface.
    pair = None
    if kind == 'floor':
        across = [f for f in families if _from_horizontal(f[0]) <= 25]
        away = [f for f in families if _from_horizontal(f[0]) > 25]
        if away:
            # Lines running away from the camera on a floor meet above the click: pick the strongest that do.
            ahead = [f for f in away if direction(f[1])[1] * np.sign(direction(f[1])[2] or 1) < 0] or away
            # A floor is level and a hand-held camera nearly so (no roll): its up is upright in the picture's plane,
            # square to the direction running away, and the lettering lies square across that direction.
            d = direction(ahead[0][1])
            up = np.array([0.0, -d[2], d[1]])
            if up[1] > 0:
                up = -up  # Up is towards the top of the picture (y down).
            u = np.cross(up, d)
            pair = (u, d)
    elif kind == 'wall':
        upright = [f for f in families if _from_horizontal(f[0]) >= 70]
        others = [f for f in families if _from_horizontal(f[0]) < 70]
        if others:
            v = direction(upright[0][1]) if upright else np.array([0.0, 1.0, 0.0])
            pair = (direction(others[0][1]), v)
    elif len(families) >= 2:
        first, second = families[0], families[1]
        writing, other = (first, second) if _from_horizontal(first[0]) <= _from_horizontal(second[0]) else (second, first)
        pair = (direction(writing[1]), direction(other[1]))
    if pair is None:
        return default(fallback, int(len(segments)))
    u, other = pair
    if u[0] < 0:
        u = -u  # Left to right.
    normal = np.cross(u, other)
    if np.linalg.norm(normal) < 1e-6:
        return default(fallback, int(len(segments)))
    pose = _pose(u, normal)
    if abs(pose['tilt_x']) > MAX_TILT or abs(pose['tilt_y']) > MAX_TILT:
        return default(fallback, int(len(segments)))  # Nearly edge-on: a title there would be unreadable.
    # Floors lean back, away from the camera; walls stand up (a little lean from the camera looking up or down).
    sensible = {'floor': 25 <= pose['tilt_x'] <= MAX_TILT, 'wall': abs(pose['tilt_x']) <= 25}.get(kind, True)
    if not sensible:
        return default(fallback, int(len(segments)))
    if kind is None:
        kind = 'floor' if abs(pose['tilt_x']) >= 40 and abs(pose['tilt_y']) < 30 else 'wall'
    return {'kind': kind, **{key: round(value, 2) for key, value in pose.items()}, 'found': True, 'lines': int(len(segments))}
