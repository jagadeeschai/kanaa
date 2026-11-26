"""Auto-ducking: music dips under the timeline's other sound (speech, vocals, clip audio) by a set amount.

While the other sound (the key) is louder than the threshold, the music sits `depth` dB lower; it fades down and back
up over about `fade` seconds. The export does it in ffmpeg (duck_graph): a sidechain gate opens on the key, and the
gated music, turned upside down and scaled, is mixed back with the music, taking it down by exactly the depth. The
editor's preview (frontend/src/editor/audio.ts, duckGain) uses the same rule; tests/test_auto_ducking.py checks both
and a real ffmpeg dip. A sound with `duck` but no preset keeps the original gentle dip (DUCK_FILTER in timeline_service.py).
"""
from __future__ import annotations

from dataclasses import dataclass

# ffmpeg's gate treats exact silence as loud (it opens): a tiny floor (-120 dB) on the key keeps it shut.
KEY_FLOOR = 'aeval=val(ch)+0.000001:c=same'


@dataclass(frozen=True)
class DuckPreset:
    threshold_db: float  # How loud the other sound must peak (dBFS) for the music to dip.
    depth_db: float  # How far the music dips.
    fade_s: float  # How long it takes to dip (coming back takes twice this).


DUCK_PRESETS: dict[str, DuckPreset] = {
    'light': DuckPreset(threshold_db=-26.0, depth_db=6.0, fade_s=0.4),
    'medium': DuckPreset(threshold_db=-30.0, depth_db=12.0, fade_s=0.3),
    'strong': DuckPreset(threshold_db=-34.0, depth_db=18.0, fade_s=0.2),
}


def resolve_duck_params(preset: str | None = None, threshold_db: float | None = None, depth_db: float | None = None,
                        fade_s: float | None = None) -> tuple[float, float, float]:
    """(threshold_db, depth_db, fade_s): the preset's, with any fine-tuned values over it."""
    base = DUCK_PRESETS.get(preset or 'medium', DUCK_PRESETS['medium'])
    return (float(base.threshold_db if threshold_db is None else threshold_db), float(base.depth_db if depth_db is None else depth_db),
            float(base.fade_s if fade_s is None else fade_s))


def dip_share(depth_db: float) -> float:
    """How much of the music is taken away while it is dipped."""
    return 1 - 10 ** (-max(0.0, depth_db) / 20)


def duck_gain(key_peak: float, threshold_db: float, depth_db: float) -> float:
    """The music's settled gain while the other sound peaks at `key_peak` (linear)."""
    return 1 - dip_share(depth_db) if key_peak > 10 ** (threshold_db / 20) else 1.0


def duck_graph(under: str, key: str, out: str, threshold_db: float, depth_db: float, fade_s: float, name: str = 'd') -> list[str]:
    """ffmpeg filter graph lines dipping the music [under] while [key] is loud, into [out]."""
    fade_ms = min(9000.0, max(10.0, fade_s * 1000))
    gate = (f'sidechaingate=threshold={10 ** (threshold_db / 20):.6f}:range=0:ratio=9000:knee=1:attack={fade_ms:.0f}'
            f':release={min(9000.0, fade_ms * 2):.0f}:detection=peak:level_sc=1')
    return [f'[{key}]{KEY_FLOOR}[{name}k]', f'[{under}]asplit=2[{name}a][{name}b]',
            f'[{name}b][{name}k]{gate},volume={-dip_share(depth_db):.6f}[{name}g]', f'[{name}a][{name}g]amix=inputs=2:normalize=0[{out}]']
