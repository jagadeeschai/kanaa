"""Auto-ducking: detect speech/vocals and build smooth volume envelopes for music tracks."""

from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np


@dataclass(frozen=True)
class DuckPreset:
    id: str
    threshold_db: float
    depth_db: float
    fade_s: float


DUCK_PRESETS: dict[str, DuckPreset] = {
    'light': DuckPreset(id='light', threshold_db=-26.0, depth_db=6.0, fade_s=0.4),
    'medium': DuckPreset(id='medium', threshold_db=-30.0, depth_db=12.0, fade_s=0.3),
    'strong': DuckPreset(id='strong', threshold_db=-34.0, depth_db=18.0, fade_s=0.2),
}


def resolve_duck_params(
    preset: str | None = None,
    threshold_db: float | None = None,
    depth_db: float | None = None,
    fade_s: float | None = None,
) -> tuple[float, float, float]:
    """Return (threshold_db, depth_db, fade_s) from preset with optional overrides."""
    base = DUCK_PRESETS.get(preset or 'medium', DUCK_PRESETS['medium'])
    return (
        float(threshold_db if threshold_db is not None else base.threshold_db),
        float(depth_db if depth_db is not None else base.depth_db),
        float(fade_s if fade_s is not None else base.fade_s),
    )


def _read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), 'rb') as wf:
        rate = wf.getframerate()
        channels = wf.getnchannels()
        width = wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())
    if width == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 4:
        samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f'Unsupported WAV sample width: {width}')
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def _load_mono_audio(source: Path, target_rate: int = 16000) -> tuple[np.ndarray, int]:
    if source.suffix.lower() == '.wav':
        return _read_wav_mono(source)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-i', str(source), '-ac', '1', '-ar', str(target_rate), '-f', 'wav', str(tmp_path)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return _read_wav_mono(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)


def detect_speech_energy(
    source: Path,
    threshold_db: float = -30.0,
    min_speech_s: float = 0.12,
    min_silence_s: float = 0.25,
    frame_s: float = 0.02,
) -> list[tuple[float, float]]:
    """Detect active speech/vocal regions using short-term RMS energy against threshold_db."""
    samples, rate = _load_mono_audio(source)
    if len(samples) == 0:
        return []
    frame_len = max(1, int(rate * frame_s))
    n_frames = len(samples) // frame_len
    if n_frames == 0:
        return []
    frames = samples[: n_frames * frame_len].reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)
    db = 20.0 * np.log10(rms)
    active = db >= threshold_db

    regions: list[tuple[float, float]] = []
    start_idx: int | None = None
    for i, is_active in enumerate(active):
        if is_active and start_idx is None:
            start_idx = i
        elif not is_active and start_idx is not None:
            regions.append((start_idx * frame_s, i * frame_s))
            start_idx = None
    if start_idx is not None:
        regions.append((start_idx * frame_s, n_frames * frame_s))

    # Merge short silences
    merged: list[tuple[float, float]] = []
    for s, e in regions:
        if merged and s - merged[-1][1] <= min_silence_s:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))

    return [(round(s, 3), round(e, 3)) for s, e in merged if (e - s) >= min_speech_s]


def detect_speech_regions(
    source: Path,
    threshold_db: float = -30.0,
    use_transcription: bool = False,
    use_stems: bool = False,
) -> list[tuple[float, float]]:
    """Detect speech/vocal regions using transcription, stems, or energy fallback."""
    if use_transcription:
        try:
            from app.services.transcript_service import transcribe
            segments = transcribe(source, 'auto', lambda _: None, lambda: False)
            if segments:
                return [(float(seg['start']), float(seg['end'])) for seg in segments if seg.get('end', 0) > seg.get('start', 0)]
        except Exception:
            pass

    if use_stems:
        try:
            from app.services.stem_service import separate
            stems = separate(source, lambda _: None, lambda: False)
            vocals_path = stems.get('vocals')
            if vocals_path and Path(vocals_path).exists():
                return detect_speech_energy(Path(vocals_path), threshold_db=threshold_db)
        except Exception:
            pass

    return detect_speech_energy(source, threshold_db=threshold_db)


def duck_gain_at(
    t: float,
    regions: list[tuple[float, float]],
    depth_db: float = 12.0,
    fade_s: float = 0.3,
) -> float:
    """Compute smooth ducking gain (0..1) at time t for the given speech regions."""
    if not regions or depth_db <= 0:
        return 1.0
    min_gain = 10.0 ** (-depth_db / 20.0)
    fade = max(0.01, fade_s)
    duck_amount = 0.0
    for start, end in regions:
        if t < start - fade or t > end + fade:
            continue
        if t < start:
            amount = (t - (start - fade)) / fade
        elif t <= end:
            amount = 1.0
        else:
            amount = 1.0 - (t - end) / fade
        if amount > duck_amount:
            duck_amount = amount
    return 1.0 - duck_amount * (1.0 - min_gain)


def ffmpeg_duck_filter(
    regions: list[tuple[float, float]],
    depth_db: float = 12.0,
    fade_s: float = 0.3,
) -> str:
    """Build an ffmpeg volume filter string applying smooth ducking over speech regions."""
    if not regions or depth_db <= 0:
        return 'anull'
    min_gain = 10.0 ** (-depth_db / 20.0)
    drop = 1.0 - min_gain
    fade = max(0.01, fade_s)
    terms: list[str] = []
    for start, end in regions:
        s0 = max(0.0, start - fade)
        e1 = end + fade
        in_expr = f'if(between(t,{s0:.3f},{start:.3f}),(t-{s0:.3f})/{fade:.3f},0)'
        hold_expr = f'if(between(t,{start:.3f},{end:.3f}),1,0)'
        out_expr = f'if(between(t,{end:.3f},{e1:.3f}),1-(t-{end:.3f})/{fade:.3f},0)'
        terms.append(f'({in_expr}+{hold_expr}+{out_expr})')
    env = '+'.join(terms)
    expr = f'1-{drop:.4f}*min(1,{env})'
    return f"volume='{expr}':eval=frame"
