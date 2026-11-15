"""Colour wheels: lift (shadows), gamma (midtones) and gain (highlights), applied after a clip's look and adjustments.

Each wheel is a hue, an amount (how strongly it pulls toward the hue) and a brightness. They become a per-channel
vector, applied the same way in the export (one lutrgb), the preview (playback.ts) and the GPU engine:
    c = c + lift * (1 - c);  c = pow(c, 1 / gamma);  c = c * gain;  clamped to 0..1.
Mirrored in frontend/src/timeline/colourWheels.ts; both are checked against timeline/fixtures/wheels.expected.json.
"""
import colorsys

LIFT_REACH = 0.25    # A full shadows wheel lifts (or with negative brightness, sinks) the darks by this much.
GAMMA_REACH = 0.5    # A full midtones wheel bends gamma by this much.
GAIN_REACH = 0.5     # A full highlights wheel scales the brights by this much.

# One-click looks, as {wheel: (hue degrees, amount, brightness)}. Reset is no wheels at all.
PRESETS = {
    'warm-shadows': {'shadows': (30, 0.5, 0.0)},
    'teal-orange': {'shadows': (190, 0.55, 0.0), 'highlights': (30, 0.45, 0.0)},
    'cool-highlights': {'highlights': (205, 0.5, 0.0)},
    'golden-hour': {'midtones': (40, 0.4, 0.05), 'highlights': (45, 0.4, 0.05)},
}


def hue_offset(hue: float, amount: float) -> tuple[float, float, float]:
    """A pull toward `hue` that keeps the average of the three channels: a tint, not a brightness change."""
    r, g, b = colorsys.hsv_to_rgb((hue % 360) / 360, 1, 1)
    mean = (r + g + b) / 3
    return tuple(round((c - mean) * amount, 6) for c in (r, g, b))


def vectors(wheels) -> dict | None:
    """{lift, gamma, gain} per channel, or None when the wheels change nothing."""
    if wheels is None:
        return None
    def wheel(name):
        w = getattr(wheels, name)
        return hue_offset(w.hue, w.amount), w.brightness
    (ls, lb), (ms, mb), (hs, hb) = wheel('shadows'), wheel('midtones'), wheel('highlights')
    lift = [round((o + lb) * LIFT_REACH, 6) for o in ls]
    gamma = [round(max(0.2, 1 + (o + mb) * GAMMA_REACH), 6) for o in ms]
    gain = [round(max(0.0, 1 + (o + hb) * GAIN_REACH), 6) for o in hs]
    if lift == [0, 0, 0] and gamma == [1, 1, 1] and gain == [1, 1, 1]:
        return None
    return {'lift': lift, 'gamma': gamma, 'gain': gain}


def apply(value: float, channel: int, v: dict) -> float:
    """One channel value (0..1) through the wheels: the reference the others are checked against."""
    c = value + v['lift'][channel] * (1 - value)
    c = max(c, 0.0) ** (1 / v['gamma'][channel])
    return min(1.0, max(0.0, c * v['gain'][channel]))


def wheel_filters(wheels) -> list[str]:
    v = vectors(wheels)
    if v is None:
        return []
    curve = lambda k: f"clip(pow(max(val/255+{v['lift'][k]:.6f}*(1-val/255),0),{1 / v['gamma'][k]:.6f})*{v['gain'][k]:.6f}*255,0,255)"
    return ['format=rgba', f"lutrgb=r='{curve(0)}':g='{curve(1)}':b='{curve(2)}'"]
