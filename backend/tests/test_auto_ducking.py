"""Unit tests for auto-ducking using generated tones and speech-like noise."""

from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest
import wave

import numpy as np

from app.services.auto_ducking import (
    DUCK_PRESETS,
    detect_speech_energy,
    detect_speech_regions,
    duck_gain_at,
    ffmpeg_duck_filter,
    resolve_duck_params,
)


def _write_wav(path: Path, samples: np.ndarray, rate: int = 16000) -> None:
    pcm = np.clip(samples * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(str(path), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(pcm.tobytes())


def _read_wav_rms(path: Path, start_s: float, end_s: float) -> float:
    with wave.open(str(path), 'rb') as wf:
        rate = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    segment = samples[int(start_s * rate) : int(end_s * rate)]
    return float(np.sqrt(np.mean(segment * segment) + 1e-12))


class AutoDuckingTests(unittest.TestCase):
    def test_presets_and_overrides(self):
        self.assertEqual(set(DUCK_PRESETS.keys()), {'light', 'medium', 'strong'})
        self.assertLess(DUCK_PRESETS['light'].depth_db, DUCK_PRESETS['medium'].depth_db)
        self.assertLess(DUCK_PRESETS['medium'].depth_db, DUCK_PRESETS['strong'].depth_db)
        thresh, depth, fade = resolve_duck_params('light', depth_db=15.0)
        self.assertEqual(thresh, DUCK_PRESETS['light'].threshold_db)
        self.assertEqual(depth, 15.0)
        self.assertEqual(fade, DUCK_PRESETS['light'].fade_s)

    def test_detect_speech_like_noise_bursts(self):
        rate = 16000
        duration = 3.0
        t = np.linspace(0, duration, int(rate * duration), endpoint=False)
        rng = np.random.default_rng(42)
        # Quiet background + speech-like modulated noise burst between 1.0s and 2.0s
        audio = 0.002 * rng.standard_normal(len(t))
        mask = (t >= 1.0) & (t <= 2.0)
        envelope = 0.5 * (1.0 + np.sin(2 * np.pi * 4.0 * t[mask]))
        speech_like = 0.25 * envelope * (
            0.6 * np.sin(2 * np.pi * 220.0 * t[mask]) + 0.4 * rng.standard_normal(np.sum(mask))
        )
        audio[mask] += speech_like

        with tempfile.TemporaryDirectory() as tmp:
            wav_path = Path(tmp) / 'speech.wav'
            _write_wav(wav_path, audio, rate)
            regions = detect_speech_regions(wav_path, threshold_db=-28.0)

        self.assertEqual(len(regions), 1)
        self.assertAlmostEqual(regions[0][0], 1.0, delta=0.15)
        self.assertAlmostEqual(regions[0][1], 2.0, delta=0.15)

    def test_smooth_envelope_gain(self):
        regions = [(1.0, 2.0)]
        self.assertAlmostEqual(duck_gain_at(0.5, regions, depth_db=12.0, fade_s=0.3), 1.0)
        mid_fade = duck_gain_at(0.85, regions, depth_db=12.0, fade_s=0.3)
        self.assertGreater(mid_fade, 10.0 ** (-12.0 / 20.0))
        self.assertLess(mid_fade, 1.0)
        self.assertAlmostEqual(duck_gain_at(1.5, regions, depth_db=12.0, fade_s=0.3), 10.0 ** (-12.0 / 20.0), places=4)
        self.assertAlmostEqual(duck_gain_at(2.5, regions, depth_db=12.0, fade_s=0.3), 1.0)

    def test_ffmpeg_duck_filter_lowers_generated_tone(self):
        rate = 16000
        duration = 3.0
        t = np.linspace(0, duration, int(rate * duration), endpoint=False)
        tone = 0.4 * np.sin(2 * np.pi * 440.0 * t)
        flt = ffmpeg_duck_filter([(1.0, 2.0)], depth_db=12.0, fade_s=0.2)

        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / 'tone.wav'
            dst = Path(tmp) / 'ducked.wav'
            _write_wav(src, tone, rate)
            subprocess.run(
                ['ffmpeg', '-y', '-i', str(src), '-af', flt, str(dst)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            rms_before = _read_wav_rms(dst, 0.1, 0.6)
            rms_during = _read_wav_rms(dst, 1.1, 1.9)
            rms_after = _read_wav_rms(dst, 2.4, 2.9)

        self.assertLess(rms_during, rms_before * 0.35)
        self.assertLess(rms_during, rms_after * 0.35)


if __name__ == '__main__':
    unittest.main()
