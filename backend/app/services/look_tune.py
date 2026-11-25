"""Fine-tuning the cinematic looks: each look starts from its preset and can be tuned with a few settings, each kept
within a safe range (so no setting can break a render). The tuned values are part of what a made copy is made from,
so a different tuning makes a different copy, and the same tuning comes back from the cache."""
from __future__ import annotations

import json

# The settings each look can be tuned by, and the range each is kept within.
KNOBS: dict[str, dict[str, tuple[float, float]]] = {
    'lens': {'amount': (0.2, 3.0), 'focus': (0.0, 1.0)},
    'atmosphere': {'density': (0.1, 1.8), 'fade': (0.0, 0.9), 'most': (0.2, 0.95)},
    'sky': {'amount': (0.0, 1.0)},
    'night': {'land': (0.1, 0.9), 'sky': (0.03, 0.6), 'colour': (0.0, 1.0)},
    'rays': {'reach': (0.2, 0.95), 'decay': (0.93, 0.995), 'strength': (0.1, 2.5)},
    'blur': {'shutter': (0.05, 1.5)},
    'match': {'amount': (0.0, 1.0), 'skin': (0.0, 1.0)},
    'freeze3d': {'swing': (0.0, 0.12), 'push': (0.0, 0.3), 'parallax': (0.5, 4.0)},
}


def parse(raw, look: str) -> dict[str, float]:
    """The tuning sent for a look: only its own settings, as numbers, each kept within its range."""
    if not isinstance(raw, dict):
        return {}
    knobs = KNOBS[look]
    found = {}
    for key, value in raw.items():
        if key in knobs and isinstance(value, (int, float)) and value == value:  # Not NaN.
            low, high = knobs[key]
            found[key] = round(min(high, max(low, float(value))), 4)
    return found


def key(tune: dict[str, float] | None) -> str:
    """What the tuning adds to a made copy's identity (nothing when untuned, so untuned copies keep their names)."""
    return json.dumps(sorted(tune.items())) if tune else ''
