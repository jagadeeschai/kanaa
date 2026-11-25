"""Fine-tuning the cinematic looks: settings are kept within safe ranges and unknown ones dropped; a tuned look is a
different copy from the untuned one (which keeps its old name); tuning changes the result; the sliders start at the
presets' own values."""
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import atmosphere_service, look_tune, night_service, time_freeze_service as freeze


class Tune(unittest.TestCase):
    def test_settings_are_kept_safe_and_unknown_ones_dropped(self):
        found = look_tune.parse({'density': 99, 'fade': -3, 'colour': 0.5, 'most': float('nan'), 'evil': 1, 'fade2': 'x'}, 'atmosphere')
        self.assertEqual(found, {'density': 1.8, 'fade': 0.0})
        self.assertEqual(look_tune.parse('nonsense', 'rays'), {})
        self.assertEqual(look_tune.key({}), '')

    def test_a_tuned_look_is_its_own_copy_and_an_untuned_one_keeps_its_name(self):
        with mock.patch.object(Path, 'stat', return_value=mock.Mock(st_size=10)):
            plain = atmosphere_service.target_path(Path('clip.mp4'), 0, 2, 'mist', 'medium')
            same = atmosphere_service.target_path(Path('clip.mp4'), 0, 2, 'mist', 'medium', {})
            tuned = atmosphere_service.target_path(Path('clip.mp4'), 0, 2, 'mist', 'medium', {'density': 0.5})
        self.assertEqual(plain, same)
        self.assertNotEqual(plain, tuned)

    def test_tuning_changes_the_result(self):
        frame = np.full((90, 160, 3), 180, np.uint8); near = np.full((90, 160), 0.6, np.float32)
        brighter = night_service.night_frame(frame, near, {**night_service.settings_for('moonlit'), 'land': 0.8})
        self.assertGreater(brighter.mean(), night_service.night_frame(frame, near, night_service.settings_for('moonlit')).mean())
        wide = freeze.path('orbit-right', 30, swing=0.1)
        self.assertGreater(wide[-1][0], freeze.path('orbit-right', 30)[-1][0])

    def test_the_sliders_start_at_the_presets(self):
        from app.api.timeline_routes import look_tuning
        found = look_tuning()
        self.assertEqual(found['defaults']['atmosphere']['mist/medium'], {'density': 0.78, 'fade': 0.25, 'most': 0.92})
        self.assertEqual(found['defaults']['night']['dark'], {'land': 0.34, 'sky': 0.17, 'colour': 0.35})
        self.assertEqual(found['lens']['knobs']['amount'], [0.2, 3.0])
        for look, presets in found['defaults'].items():  # Every default sits within its range.
            for values in presets.values():
                for key, value in values.items():
                    low, high = look_tune.KNOBS[look][key]
                    self.assertTrue(low <= value <= high, (look, key, value))


if __name__ == '__main__':
    unittest.main()
