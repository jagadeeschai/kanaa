"""One-click sound presets: a few gentle EQ and compressor settings for a voice or a song.

Each preset is a list of steps, the same numbers as frontend/src/timeline/audioPresets.ts, which the preview builds
as Web Audio BiquadFilter and DynamicsCompressor nodes. Shelves use slope 1 (Web Audio's fixed shelf shape).
"""
PRESETS: dict[str, list[dict]] = {
    'remove-rumble': [{'type': 'highpass', 'frequency': 80}],
    'clearer-voice': [{'type': 'highpass', 'frequency': 100}, {'type': 'peaking', 'frequency': 3000, 'gain': 3, 'q': 1}],
    'warmer-music': [{'type': 'lowshelf', 'frequency': 200, 'gain': 2}, {'type': 'highshelf', 'frequency': 8000, 'gain': -2}],
    'even-out': [{'type': 'compressor', 'threshold': -18, 'ratio': 2, 'attack': 0.02, 'release': 0.25, 'knee': 6}],
}
ORDER = list(PRESETS)  # Applied in this order whatever order they were picked in, as the preview does.


def step_filter(step: dict) -> str:
    kind = step['type']
    if kind == 'highpass':
        return f"highpass=f={step['frequency']}:p=2:t=q:w=0.7071"
    if kind == 'peaking':
        return f"equalizer=f={step['frequency']}:t=q:w={step['q']}:g={step['gain']}"
    if kind == 'lowshelf':
        return f"bass=f={step['frequency']}:t=s:w=1:g={step['gain']}"
    if kind == 'highshelf':
        return f"treble=f={step['frequency']}:t=s:w=1:g={step['gain']}"
    if kind == 'compressor':
        return (f"acompressor=threshold={step['threshold']}dB:ratio={step['ratio']}:attack={step['attack'] * 1000:g}"
                f":release={step['release'] * 1000:g}:knee={10 ** (step['knee'] / 20):.4f}")
    raise ValueError(kind)


def preset_filters(presets) -> list[str]:
    chosen = set(presets or [])
    return [step_filter(step) for name in ORDER if name in chosen for step in PRESETS[name]]
