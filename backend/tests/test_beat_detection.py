import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.api.routes import embedded_lyrics
from app.services.beat_service import SAMPLE_RATE, beats_from_strength, detect_beats, onset_strength


def click_track(bpm: float, seconds: float) -> np.ndarray:
    samples = np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)
    for beat in np.arange(0.5, seconds - 0.1, 60 / bpm):
        start = int(beat * SAMPLE_RATE)
        burst = np.exp(-np.arange(600) / 120) * np.sin(np.arange(600) * 0.9)
        samples[start:start + 600] += burst[:len(samples[start:start + 600])].astype(np.float32)
    return samples


class BeatDetectionTests(unittest.TestCase):
    def test_finds_tempo_and_beat_positions(self):
        for bpm in (90, 120, 140):
            with self.subTest(bpm=bpm):
                beats, found = beats_from_strength(onset_strength(click_track(bpm, 30)))
                self.assertAlmostEqual(found, bpm, delta=3)
                expected = np.arange(0.5, 29.9, 60 / bpm)
                offsets = [abs(expected - beat).min() for beat in beats]
                self.assertLess(np.median(offsets), 0.04)

    def test_silence_has_no_beats(self):
        self.assertEqual(beats_from_strength(onset_strength(np.zeros(SAMPLE_RATE * 10, dtype=np.float32))), ([], 0.0))

    def test_reads_a_real_audio_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'clicks.wav'
            raw = Path(folder) / 'clicks.raw'
            raw.write_bytes(click_track(120, 12).tobytes())
            subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'f32le', '-ar', str(SAMPLE_RATE), '-ac', '1', '-i', str(raw), str(path)], check=True, capture_output=True, timeout=10)
            self.assertAlmostEqual(detect_beats(path)[1], 120, delta=4)

    def test_embedded_lyrics_are_found_in_common_tags(self):
        self.assertEqual(embedded_lyrics({'format': {'tags': {'lyrics-eng': 'வரி'}}}), 'வரி')
        self.assertEqual(embedded_lyrics({'format': {}, 'streams': [{'tags': {'LYRICS': 'line'}}]}), 'line')
        self.assertIsNone(embedded_lyrics({'format': {'tags': {'title': 'x'}}}))
