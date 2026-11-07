"""Titles in 3D: leaning back, turning, extruded depth, and locking to the scene.

A title is one picture the size of the frame (render_text_image). Flat titles are posed by ffmpeg as before. A title
with tilt, depth or a pin is worked out here as four corners per frame for each of its depth layers, through a fixed
virtual camera, then warped. frontend/src/timeline/title3d.ts holds the same maths, and both are tested on the same
numbers, so the preview and the export put every corner in the same place.

Coordinates are frame pixels, y down. The flat title (no tilt, no depth, no pin) lands exactly where it does today.
"""
from __future__ import annotations

import math

from app.services.animation import look_at

FOV = 40  # Degrees, vertical, of the virtual camera. Mirrored in title3d.ts.
MAX_LAYERS = 15  # Depth layers at full depth, the front one included.
DEPTH_SPAN = 0.12  # How far the back layer sits behind the front, as a share of the frame height, at full depth.
# The direction the letters are extruded in, in the title's own space: back, and a little down and right, so the
# sides show as they do on cinema titles. It turns with the tilt, like the sides of a solid object. Mirrored in title3d.ts.
EXTRUDE_Z = 1.0
EXTRUDE_XY = math.hypot(0.25, 0.55)  # Fixed screen-plane slant magnitude; its direction is `depth_angle`.
DEFAULT_DEPTH_ANGLE = math.degrees(math.atan2(0.25, 0.55))  # The old fixed slant, as an angle from straight-down towards the right.
ALPHA_EDGE = 8  # A pixel with more alpha than this (of 255) is part of the title, for finding its box.


def is_3d(text) -> bool:
    """Whether the title needs this path: any tilt, depth, pin, or a preset that tilts."""
    transform = text.transform
    tilts = any(getattr(transform, name) for name in ('tilt_x', 'tilt_y')) or any(transform.keyframes.get(name) for name in ('tilt_x', 'tilt_y'))
    presets = any(animation and animation.preset in TILTING for animation in (text.enter, text.exit))
    return bool(tilts or presets or (text.depth and text.depth.amount > 0) or text.pin)


TILTING = {'rise-behind', 'push-through'}


def animated_look(enter, exit_, local: float, length: float) -> dict[str, float]:
    """Enter and exit combined, as animatedLook in animation.ts: offsets and tilt add, scale and opacity multiply."""
    excess = max(1, ((enter.duration if enter else 0) + (exit_.duration if exit_ else 0)) / length)
    rest = {'dx': 0.0, 'dy': 0.0, 'scale': 1.0, 'opacity': 1.0, 'blur': 0.0, 'tilt': 0.0}
    first = look_at(enter.preset, local / (enter.duration / excess)) if enter else rest
    last = look_at(exit_.preset, (length - local) / (exit_.duration / excess)) if exit_ else rest
    return {'dx': first['dx'] + last['dx'], 'dy': first['dy'] + last['dy'], 'scale': first['scale'] * last['scale'],
            'opacity': first['opacity'] * last['opacity'], 'blur': max(first['blur'], last['blur']), 'tilt': first.get('tilt', 0) + last.get('tilt', 0)}


def layers(depth) -> list[float]:
    """Each layer's share of the full depth, front (0) to back."""
    if not depth or depth.amount <= 0:
        return [0.0]
    count = 1 + round(depth.amount * (MAX_LAYERS - 1))
    return [k / (count - 1) for k in range(count)] if count > 1 else [0.0]


def layer_shade(depth, share: float) -> float:
    """How bright a layer's sides are: lit near the front, darker towards the back."""
    return 0.35 + 0.65 * depth.light * (1 - share)


def corners(pose: dict[str, float], box: tuple[float, float, float, float], size: tuple[int, int], depth_share: float = 0.0,
            depth_amount: float = 0.0, pin=None, depth_angle: float = DEFAULT_DEPTH_ANGLE) -> list[tuple[float, float]]:
    """Where the corners of `box` (x0, y0, x1, y1 in the title picture's pixels) land on the frame.

    pose: cx, cy (frame shares), size (scale), turn (degrees), tilt_x and tilt_y (degrees). pin: a 3x3 matrix taking the
    frame at the pin moment to this frame, or None. Corners are in the order top-left, top-right, bottom-right, bottom-left.
    """
    width, height = size
    turn = math.radians(pose['turn'])
    ct, st = math.cos(turn), math.sin(turn)

    def placed(px: float, py: float) -> tuple[float, float]:
        # The flat pose, exactly as the preview's vertex shader places the picture.
        dx, dy = (px - width / 2) * pose['size'], (py - height / 2) * pose['size']
        return pose['cx'] * width + dx * ct - dy * st, pose['cy'] * height + dx * st + dy * ct

    x0, y0, x1, y1 = box
    qx, qy = placed((x0 + x1) / 2, (y0 + y1) / 2)  # The title's own middle, which it tilts about.
    a, b = math.radians(pose['tilt_x']), math.radians(pose['tilt_y'])
    ca, sa, cb, sb = math.cos(a), math.sin(a), math.cos(b), math.sin(b)
    focal = (height / 2) / math.tan(math.radians(FOV / 2))
    push = depth_share * depth_amount * DEPTH_SPAN * height
    out = []
    for px, py in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        fx, fy = placed(px, py)
        slant = math.radians(depth_angle)
        ex, ey = EXTRUDE_XY * math.sin(slant), EXTRUDE_XY * math.cos(slant)
        lx, ly, lz = fx - qx + ex * push, fy - qy + ey * push, EXTRUDE_Z * push
        # Turn first (right side away), then lean back (top away).
        x, z = lx * cb - lz * sb, lx * sb + lz * cb
        y, z = ly * ca + z * sa, -ly * sa + z * ca
        scale = focal / max(focal + z, focal * 0.05)
        sx, sy = width / 2 + (qx + x - width / 2) * scale, height / 2 + (qy + y - height / 2) * scale
        if pin is not None:
            w = pin[2][0] * sx + pin[2][1] * sy + pin[2][2]
            sx, sy = (pin[0][0] * sx + pin[0][1] * sy + pin[0][2]) / w, (pin[1][0] * sx + pin[1][1] * sy + pin[1][2]) / w
        out.append((sx, sy))
    return out


def homography(source: list[tuple[float, float]], target: list[tuple[float, float]]) -> list[list[float]]:
    """The 3x3 matrix taking four source points to four target points (the last entry fixed at 1)."""
    rows, values = [], []
    for (x, y), (u, v) in zip(source, target):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.append(u)
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y]); values.append(v)
    h = _solve(rows, values)
    return [h[0:3], h[3:6], [h[6], h[7], 1.0]]


def _solve(rows: list[list[float]], values: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting, the same steps as title3d.ts."""
    n = len(values)
    m = [row[:] + [value] for row, value in zip(rows, values)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[pivot] = m[pivot], m[col]
        if abs(m[col][col]) < 1e-12:
            raise ValueError('The title is turned edge-on.')
        for r in range(n):
            if r != col:
                factor = m[r][col] / m[col][col]
                for c in range(col, n + 1):
                    m[r][c] -= factor * m[col][c]
    return [m[r][n] / m[r][r] for r in range(n)]


def pose_at(text, local: float) -> tuple[dict[str, float], dict[str, float]]:
    """The title's pose and look `local` seconds in: the same values drawText uses in the preview."""
    from app.services.timeline_schema import value_at
    look = animated_look(text.enter, text.exit, local, text.length)
    t = text.transform
    pose = {'cx': 0.5 + look['dx'] + (value_at(t, 'x', local) - 0.5) * look['scale'],
            'cy': 0.5 + look['dy'] + (value_at(t, 'y', local) - 0.5) * look['scale'],
            'size': value_at(t, 'scale', local) * look['scale'], 'turn': value_at(t, 'rotation', local),
            'tilt_x': value_at(t, 'tilt_x', local) + look['tilt'], 'tilt_y': value_at(t, 'tilt_y', local)}
    return pose, look


def clip_placement(clip, facts, fmt, local: float) -> list[list[float]]:
    """Source 0..1 coordinates to frame pixels for a clip as it sits on the frame (fitted, then its scale and place).
    The same rule as fittedSize in model.ts; a clip's own rotation keyframes are not followed."""
    from app.services.timeline_schema import value_at
    w, h = (facts.height, facts.width) if clip.adjust.rotation % 180 else (facts.width, facts.height)
    w, h = w or fmt.width, h or fmt.height
    fit = min(fmt.width / w, fmt.height / h)
    s = value_at(clip.transform, 'scale', local)
    fw, fh = w * fit * s, h * fit * s
    cx, cy = value_at(clip.transform, 'x', local) * fmt.width, value_at(clip.transform, 'y', local) * fmt.height
    return [[fw, 0, cx - fw / 2], [0, fh, cy - fh / 2], [0, 0, 1]]


def _multiply(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(3)) for c in range(3)] for r in range(3)]


def _inverse(m):
    (a, b, c), (d, e, f), (g, h, i) = m
    A, B, C = e * i - f * h, -(d * i - f * g), d * h - e * g
    det = a * A + b * B + c * C
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]


def source_seconds(clip, timeline_seconds: float) -> float:
    return clip.in_ + (timeline_seconds - clip.start) * clip.speed


def pinned(timeline, text):
    """The clip a title is locked to and the source stretch to follow (start, end, at), or None if it is not on the timeline."""
    for layer in timeline.layers:
        if layer.kind != 'video':
            continue
        for clip in layer.items:
            if clip.id == text.pin.clip_id:
                start = max(clip.in_, source_seconds(clip, text.start))
                end = min(clip.out, source_seconds(clip, text.start + text.length))
                at = min(max(source_seconds(clip, text.pin.at), start), end)
                return clip, start, end, at
    return None


def scene_matrix(track: dict, clip, facts, fmt, timeline_seconds: float, pin_seconds: float) -> list[list[float]]:
    """Frame pixels at the pin moment to frame pixels at `timeline_seconds`, for a title locked to the scene."""
    from app.services.scene_track_service import matrix_at
    place = clip_placement(clip, facts, fmt, pin_seconds - clip.start)
    return _multiply(_multiply(place, matrix_at(track, source_seconds(clip, timeline_seconds))), _inverse(place))
