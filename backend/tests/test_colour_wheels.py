"""F3: colour wheels. The maths against the shared fixture, and the export drawing what the maths says."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import colour_wheels as w
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import ColourWheels, Timeline
from app.services.timeline_service import render_timeline

FIXTURE = json.loads((Path(__file__).parents[2] / 'timeline/fixtures/wheels.expected.json').read_text())


class Maths(unittest.TestCase):
    def test_matches_the_shared_fixture(self):
        for name, case in FIXTURE['cases'].items():
            v = w.vectors(ColourWheels.model_validate(case['wheels']))
            self.assertEqual(v, case['vectors'], name)
            for channel in range(3):
                for x, expected in zip(FIXTURE['samples'], case['out'][channel]):
                    self.assertAlmostEqual(w.apply(x, channel, v), expected, places=5, msg=name)

    def test_presets_are_in_the_fixture_and_flat_wheels_do_nothing(self):
        self.assertTrue(set(w.PRESETS) <= set(FIXTURE['cases']))
        self.assertIsNone(w.vectors(ColourWheels()))
        self.assertEqual(w.wheel_filters(ColourWheels()), [])

    def test_a_hue_pull_keeps_the_average_brightness(self):
        for hue in (0, 40, 190, 300):
            self.assertAlmostEqual(sum(w.hue_offset(hue, 1)), 0, places=5)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Export(unittest.TestCase):
    def test_greys_come_out_as_the_maths_says(self):
        root = Path(tempfile.mkdtemp())
        try:
            picture = root / 'greys.png'
            levels = [16, 64, 128, 192, 240]
            strip = np.repeat(np.repeat(np.array(levels, np.uint8)[None, :, None], 3, 2), 86, 1)
            from PIL import Image
            Image.fromarray(np.repeat(strip, 240, 0)).resize((430, 240), Image.NEAREST).save(picture)
            wheels = {'shadows': {'hue': 190, 'amount': 0.55}, 'midtones': {'hue': 40, 'amount': 0.3, 'brightness': 0.1}, 'highlights': {'hue': 30, 'amount': 0.45}}
            timeline = Timeline.model_validate({'format': {'width': 430, 'height': 240, 'fps': 30}, 'layers': [
                {'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1, 'wheels': wheels}]}]})
            out = root / 'out.mp4'
            with mock.patch.dict(os.environ, {'KANAA_PARALLEL_EXPORT': '0', 'KANAA_GPU_RENDER': '0'}):
                render_timeline(timeline, {1: MediaFacts(path=picture, media_type='image', width=430, height=240)}.__getitem__, lambda _: None, out, lambda _: None, hardware=False)
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
            frame = np.frombuffer(raw, np.uint8).reshape(240, 430, 3).astype(float)
            v = w.vectors(timeline.layers[0].items[0].wheels)
            for n, level in enumerate(levels):
                got = frame[100:140, n * 86 + 25:n * 86 + 60].reshape(-1, 3).mean(0)
                want = [w.apply(level / 255, k, v) * 255 for k in range(3)]
                for k in range(3):
                    self.assertAlmostEqual(got[k], want[k], delta=5, msg=(level, k, got, want))  # yuv420p encoding noise.
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
