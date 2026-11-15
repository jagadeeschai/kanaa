"""F4: one-click sound presets. The export's filters, measured on test tones, and the same numbers as the preview."""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

from app.services import audio_presets
from app.services.timeline_schema import Sound
from app.services.timeline_service import sound_steps

FIXTURE = json.loads((Path(__file__).parents[2] / 'timeline/fixtures/audio-presets.expected.json').read_text())


def level(source: str, presets: list[str]) -> float:
    """Mean loudness in dB of `source` (an ffmpeg lavfi source) after the presets, its first half second skipped."""
    chain = ','.join([*audio_presets.preset_filters(presets), 'atrim=start=0.5', 'volumedetect']) or 'volumedetect'
    log = subprocess.run(['ffmpeg', '-v', 'info', '-f', 'lavfi', '-i', source, '-af', chain, '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.search(r'mean_volume: (-?[0-9.]+) dB', log).group(1))


def tone(frequency, volume=0.25):
    return f'sine=f={frequency}:d=2:r=48000,volume={volume}'


class Definitions(unittest.TestCase):
    def test_same_numbers_as_the_preview(self):
        self.assertEqual(audio_presets.PRESETS, FIXTURE)

    def test_order_is_fixed_and_steps_reach_the_export(self):
        self.assertEqual(audio_presets.preset_filters(['even-out', 'remove-rumble']), audio_presets.preset_filters(['remove-rumble', 'even-out']))
        sound = Sound.model_validate({'id': 's', 'asset_id': 'a' * 32, 'start': 1, 'in': 0, 'out': 5, 'audio_presets': ['clearer-voice']})
        steps = sound_steps(sound)
        self.assertTrue(any(step.startswith('equalizer=f=3000') for step in steps))
        self.assertLess(next(i for i, s in enumerate(steps) if s.startswith('highpass')), next(i for i, s in enumerate(steps) if s.startswith('adelay')))


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Levels(unittest.TestCase):
    def change(self, source, presets):
        return level(source, presets) - level(source, [])

    def test_remove_rumble_cuts_the_lows_and_keeps_the_voice(self):
        self.assertLess(self.change(tone(30), ['remove-rumble']), -8)
        self.assertAlmostEqual(self.change(tone(1000), ['remove-rumble']), 0, delta=0.3)

    def test_clearer_voice_lifts_presence(self):
        self.assertAlmostEqual(self.change(tone(3000), ['clearer-voice']), 3, delta=0.4)
        self.assertLess(self.change(tone(50), ['clearer-voice']), -6)

    def test_warmer_music_adds_body_and_softens_highs(self):
        self.assertGreater(self.change(tone(80), ['warmer-music']), 1.2)
        self.assertLess(self.change(tone(14000), ['warmer-music']), -1.2)
        self.assertAlmostEqual(self.change(tone(1000), ['warmer-music']), 0, delta=0.6)

    def test_even_out_brings_loud_down_and_leaves_quiet(self):
        self.assertLess(self.change(tone(440, 6), ['even-out']), -2)
        self.assertAlmostEqual(self.change(tone(440, 0.1), ['even-out']), 0, delta=0.5)

    def test_noise_keeps_its_level_through_a_gentle_preset(self):
        noise = 'anoisesrc=d=2:c=pink:r=48000:a=0.1'
        self.assertAlmostEqual(self.change(noise, ['clearer-voice']), 0, delta=2.5)


if __name__ == '__main__':
    unittest.main()
