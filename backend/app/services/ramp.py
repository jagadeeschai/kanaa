"""Speed ramps: relative speed at points through a clip's time, scaled to average 1. Matches frontend/src/timeline/ramp.ts."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Segment:
    t0: float
    t1: float
    r0: float
    r1: float
    x0: float
    x1: float


def segments(ramp) -> list[Segment]:
    mean = sum((b.t - a.t) * (a.v + b.v) / 2 for a, b in zip(ramp, ramp[1:]))
    parts, x = [], 0.0
    for a, b in zip(ramp, ramp[1:]):
        r0, r1 = a.v / mean, b.v / mean
        parts.append(Segment(a.t, b.t, r0, r1, x, x + (b.t - a.t) * (r0 + r1) / 2))
        x = parts[-1].x1
    return parts


def ramp_share(ramp, u: float) -> float:
    """The share of the source played after `u` of the clip's time. The end speeds carry on outside 0..1."""
    parts = segments(ramp)
    if u <= 0:
        return u * parts[0].r0
    if u >= 1:
        return 1 + (u - 1) * parts[-1].r1
    part = next(item for item in parts if u <= item.t1)
    d = u - part.t0
    return part.x0 + part.r0 * d + (part.r1 - part.r0) / (part.t1 - part.t0) * d * d / 2


def ramp_time_expression(ramp, x: str) -> str:
    """An ffmpeg expression for how far through the clip's time the source share `x` plays: the inverse of ramp_share."""
    parts = segments(ramp)
    tail = f'(1+({x}-1)/{parts[-1].r1:.9f})'
    for part in reversed(parts):
        k = (part.r1 - part.r0) / (part.t1 - part.t0)
        into = f'({x}-{part.x0:.9f})'
        piece = f'({part.t0:.9f}+{into}/{part.r0:.9f})' if abs(k) < 1e-9 else f'({part.t0:.9f}+(sqrt(max(0,{part.r0 * part.r0:.9f}+{2 * k:.9f}*{into}))-{part.r0:.9f})/{k:.9f})'
        tail = f'if(lt({x},{part.x1:.9f}),{piece},{tail})'
    return f'if(lt({x},0),{x}/{parts[0].r0:.9f},{tail})'
