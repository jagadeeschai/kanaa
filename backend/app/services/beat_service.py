from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 11025
FRAME_SIZE = 1024
HOP_SIZE = 128
BATCH_FRAMES = 4096
MIN_BPM, MAX_BPM = 60, 180
# Tempo estimates pull toward a natural pulse rather than double or half time.
PREFERRED_BPM = 110
DECODE_TIMEOUT_SECONDS = 120


def onset_strength(samples: np.ndarray) -> np.ndarray:
    """How much new sound starts in each hop, measured as rising energy across frequencies."""
    window = np.hanning(FRAME_SIZE)
    frame_count = max(0, (len(samples) - FRAME_SIZE) // HOP_SIZE)
    strength = np.zeros(frame_count)
    previous = np.zeros(FRAME_SIZE // 2 + 1)
    for first in range(0, frame_count, BATCH_FRAMES):
        starts = np.arange(first, min(first + BATCH_FRAMES, frame_count)) * HOP_SIZE
        frames = samples[starts[:, None] + np.arange(FRAME_SIZE)] * window
        magnitude = np.log1p(np.abs(np.fft.rfft(frames, axis=1)))
        rises = np.diff(magnitude, axis=0, prepend=previous[None, :])
        strength[first:first + len(starts)] = np.maximum(rises, 0).sum(axis=1)
        previous = magnitude[-1]
    return strength


def beats_from_strength(strength: np.ndarray) -> tuple[list[float], float]:
    seconds_per_hop = HOP_SIZE / SAMPLE_RATE
    if len(strength) < int(4 / seconds_per_hop) or not strength.any():
        return [], 0.0
    centered = strength - strength.mean()
    spectrum = np.fft.rfft(centered, n=2 * len(centered))
    correlation = np.fft.irfft(spectrum * np.conj(spectrum))[:len(centered)]
    shortest = int(60 / MAX_BPM / seconds_per_hop)
    longest = min(int(60 / MIN_BPM / seconds_per_hop), len(correlation) - 1)
    lags = np.arange(shortest, longest + 1)
    preference = np.exp(-0.5 * (np.log2(60 / (lags * seconds_per_hop) / PREFERRED_BPM) / 0.7) ** 2)
    period = int(lags[np.argmax(correlation[lags] * preference)])
    offset = int(np.argmax([strength[start::period].sum() for start in range(period)]))
    reach = max(1, period // 10)
    beats = []
    position = offset
    while position < len(strength):
        low, high = max(0, position - reach), min(len(strength), position + reach + 1)
        # Follow the music's small drifts instead of a rigid grid.
        peak = low + int(np.argmax(strength[low:high]))
        # A frame registers an onset once it reaches the middle of the frame.
        beats.append(round(peak * seconds_per_hop + FRAME_SIZE / 2 / SAMPLE_RATE, 3))
        position = peak + period
    # The spacing of the tracked beats is finer than one lag step.
    return beats, round(60 / float(np.median(np.diff(beats))), 1) if len(beats) > 1 else 0.0


def detect_beats(audio: Path) -> tuple[list[float], float]:
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('Beat detection requires ffmpeg on the server.')
    decoded = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', str(audio), '-vn', '-ac', '1', '-ar', str(SAMPLE_RATE), '-f', 'f32le', '-'],
                             capture_output=True, timeout=DECODE_TIMEOUT_SECONDS)
    if decoded.returncode:
        raise ValueError('The song could not be read for beat detection.')
    return beats_from_strength(onset_strength(np.frombuffer(decoded.stdout, dtype=np.float32)))
