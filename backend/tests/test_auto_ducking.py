"""Auto-ducking: the presets set how the music dips, the export's filter and the preview's curve agree, and a real
export dips the music under other sound by about the preset's depth. Generated tones only."""
from __future__ import annotations

import json
import math
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.services.auto_ducking import DUCK_PRESETS, duck_gain, duck_graph, resolve_duck_params

FRONTEND = Path(__file__).resolve().parents[2] / 'frontend'


class Presets(unittest.TestCase):
    def test_fine_tuning_goes_over_the_preset(self):
        self.assertEqual(resolve_duck_params('strong'), (-34.0, 18.0, 0.2))
        self.assertEqual(resolve_duck_params('light', depth_db=9), (-26.0, 9.0, 0.4))

    def test_each_preset_dips_by_its_depth_under_loud_sound_and_not_at_all_under_quiet(self):
        for preset in DUCK_PRESETS.values():
            loud = duck_gain(10 ** ((preset.threshold_db + 3) / 20), preset.threshold_db, preset.depth_db)
            self.assertAlmostEqual(-20 * math.log10(loud), preset.depth_db, places=6)
            self.assertEqual(duck_gain(10 ** ((preset.threshold_db - 3) / 20), preset.threshold_db, preset.depth_db), 1.0)

    def test_the_graph_carries_the_settings(self):
        made = ';'.join(duck_graph('u', 'k', 'o', -30, 12, 0.3))
        self.assertIn('threshold=0.031623', made)
        self.assertIn('attack=300', made)
        self.assertIn('volume=-0.748811', made)


class PreviewMatchesExport(unittest.TestCase):
    def test_the_preview_curve_is_the_same(self):
        cases = [[peak, threshold, depth] for peak in (0.001, 0.03, 0.2, 0.9) for threshold, depth in ((-26, 6), (-30, 12), (-34, 18))]
        script = f"import {{ duckGain }} from './src/timeline/ducking.ts'; console.log(JSON.stringify({json.dumps(cases)}.map(([p, t, d]) => duckGain(p, t, d))));"
        out = subprocess.run(['node', '--input-type=module', '-e', script], cwd=FRONTEND, capture_output=True, text=True, check=True).stdout
        for (peak, threshold, depth), preview in zip(cases, json.loads(out)):
            self.assertAlmostEqual(preview, duck_gain(peak, threshold, depth), places=9)


class RealDip(unittest.TestCase):
    def test_ffmpeg_dips_the_music_under_speech_by_the_preset(self):
        rate = 16000
        with tempfile.TemporaryDirectory() as folder:
            music, speech, out = (Path(folder) / name for name in ('music.wav', 'speech.wav', 'out.wav'))
            # Music: a steady 220 Hz tone for 4 s. Speech: noise bursts from 1.5 to 3 s only.
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency=220:sample_rate={rate}:duration=4', '-af', 'volume=0.3', str(music)], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'anoisesrc=color=pink:amplitude=0.5:sample_rate={rate}:duration=4',
                            '-af', "volume='between(t,1.5,3)':eval=frame", str(speech)], check=True)
            graph = ';'.join(duck_graph('0:a', '1:a', 'o', *resolve_duck_params('medium')))
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(music), '-i', str(speech), '-filter_complex', graph,
                            '-map', '[o]', '-ac', '1', '-f', 's16le', str(out)], check=True)
            samples = np.frombuffer(out.read_bytes(), np.int16).astype(np.float32)
        level = lambda a, b: float(np.sqrt(np.mean(samples[int(a * rate):int(b * rate)] ** 2)))
        full = level(0.3, 1.2)  # Before the speech: not dipped, also with the other sound silent.
        self.assertAlmostEqual(20 * math.log10(full / (0.3 / 8 * 32767 / 2 ** 0.5)), 0, delta=0.5)  # ffmpeg sine is 1/8 full scale.
        self.assertAlmostEqual(20 * math.log10(level(2.0, 2.9) / full), -12, delta=0.5)
        self.assertAlmostEqual(20 * math.log10(level(3.7, 3.95) / full), 0, delta=0.5)  # Back up after.


if __name__ == '__main__':
    unittest.main()
