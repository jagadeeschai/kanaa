"""Multicam sync by sound: recordings of the same moment from different cameras or phones, lined up by what they
heard. Each clip's sound is reduced to its rhythm (how its loudness changes, every 10 ms) and slid against the first
clip's to find where they agree best; then the raw sound around that point fine-tunes it to a fraction of a
millisecond. How clearly that best point stands out says how sure the match is, so a clip that never heard the same
thing is reported instead of being placed somewhere wrong.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.services.job_service import JobCancelled

RATE = 8000  # Samples a second: speech and music rhythm, quickly.
HOP = 80  # Samples per rhythm step: 10 ms.
LONGEST = 900  # Seconds of each recording listened to.
REFINE = 0.02  # Seconds either side of the rough match that the raw sound fine-tunes.
SURE = 0.33  # How sure (0..1) a match must be to use. A true match was 0.77 to 0.92 alike, at least 2.4 times better
# than anywhere else; recordings of different things at most 0.32 alike, barely above their next-best place.
ALIKE_FROM, ALIKE_SPAN = 0.3, 0.3  # How alike the best place is: 0.3 counts for nothing, 0.6 for everything.
ABOVE_FROM, ABOVE_SPAN = 1.2, 1.0  # How far above the next-best place (away from it): 1.2× nothing, 2.2× everything.


def sound(path: Path) -> np.ndarray:
    raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-i', str(path), '-t', str(LONGEST), '-vn', '-ac', '1', '-ar', str(RATE),
                          '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def rhythm(samples: np.ndarray) -> np.ndarray:
    """How the loudness rises, every 10 ms: the beats, words and claps both recordings heard, not their tone."""
    steps = len(samples) // HOP
    if steps < 2:
        return np.zeros(0, np.float32)
    energy = np.log1p(1000 * (samples[:steps * HOP].reshape(steps, HOP) ** 2).mean(axis=1))
    rises = np.maximum(0, np.diff(energy, prepend=energy[0]))
    spread = rises.std()
    return ((rises - rises.mean()) / spread).astype(np.float32) if spread > 1e-6 else np.zeros_like(rises)


def _slide(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Cross-correlation of a and b at every lag, by FFT: index k means b starts k steps into a (negative: before)."""
    size = 1 << int(np.ceil(np.log2(len(a) + len(b))))
    found = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    return np.concatenate([found[-(len(b) - 1):], found[:len(a)]])  # Lags −(len b − 1) .. len a − 1.


def offset(reference: np.ndarray, other: np.ndarray) -> tuple[float, float]:
    """Where `other` starts on `reference`'s clock, in seconds (negative: it started earlier), and how sure (≥ 0)."""
    a, b = rhythm(reference), rhythm(other)
    if not len(a) or not len(b):
        return 0.0, 0.0
    scores = _slide(a, b)
    # Lags where the two barely overlap match by chance: count only those sharing at least a few seconds (or most of
    # the shorter one).
    lags = np.arange(-(len(b) - 1), len(a))
    shared = np.minimum(len(a), lags + len(b)) - np.maximum(0, lags)
    scores = np.where(shared >= min(300, 0.5 * min(len(a), len(b))), scores / np.maximum(shared, 1), -np.inf)
    best = int(np.argmax(scores))
    if not np.isfinite(scores[best]):
        return 0.0, 0.0
    away = np.isfinite(scores) & (np.abs(np.arange(len(scores)) - best) > 50)  # Half a second or more from it.
    second = float(scores[away].max()) if away.any() else 0.0
    alike = (float(scores[best]) - ALIKE_FROM) / ALIKE_SPAN
    above = (float(scores[best]) / max(second, 1e-3) - ABOVE_FROM) / ABOVE_SPAN
    sure = max(0.0, min(1.0, alike, above))
    rough = lags[best] * HOP  # Samples.
    return _refine(reference, other, rough) / RATE, sure


def _refine(reference: np.ndarray, other: np.ndarray, rough: int) -> float:
    """The rough match, fine-tuned on the raw sound within ±REFINE (to the sample, then between samples)."""
    reach = int(REFINE * RATE)
    start = max(0, rough) + RATE  # A second in, where both play.
    length = min(20 * RATE, len(reference) - start - reach, len(other) - (start - rough) - reach)
    if length < RATE // 2:
        return float(rough)
    piece = reference[start:start + length]
    best, best_score, scores = rough, -np.inf, []
    for shift in range(-reach, reach + 1):
        begin = start - rough - shift
        if begin < 0 or begin + length > len(other):
            scores.append(-np.inf); continue
        candidate = other[begin:begin + length]
        score = float(np.dot(piece, candidate) / (np.linalg.norm(piece) * np.linalg.norm(candidate) + 1e-9))
        scores.append(score)
        if score > best_score:
            best, best_score = rough + shift, score
    k = best - rough + reach
    if 0 < k < len(scores) - 1 and np.isfinite(scores[k - 1]) and np.isfinite(scores[k + 1]):
        left, mid, right = scores[k - 1], scores[k], scores[k + 1]
        bend = left - 2 * mid + right
        if bend < 0:
            return best + 0.5 * (left - right) / bend
    return float(best)


def sync(paths: list[Path], on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> list[dict]:
    """For each recording after the first: where it starts on the first's clock (seconds), how sure, and whether
    that is sure enough to use. The first is the reference (offset 0)."""
    reference = sound(paths[0])
    found = [{'offset': 0.0, 'sure': 1.0, 'synced': True}]
    for number, path in enumerate(paths[1:], start=1):
        if should_cancel():
            raise JobCancelled()
        other = sound(path)
        at, sure = offset(reference, other)
        found.append({'offset': round(at, 4), 'sure': round(sure, 3), 'synced': sure >= SURE})
        on_progress(number * 100 // max(1, len(paths) - 1))
    return found
