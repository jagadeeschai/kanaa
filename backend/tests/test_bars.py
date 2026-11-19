"""Adjustable cinematic bars: the shape between them (above and below, or at the sides), their colour, and the same
sizes as the preview's barShares (frontend/tests/bars.test.mjs checks the same numbers)."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.services.finish_service import bar_shares, finish_filters
from app.services.timeline_schema import Finish

CASES = [((1920, 1080, None), (0.0, 0.12808)), ((1920, 1080, 1.85), (0.0, 0.01952)), ((1920, 1080, 4 / 3), (0.125, 0.0)), ((1080, 1920, 1.0), (0.0, 0.21875)), ((1080, 1920, None), (0.0, 0.0))]


class Bars(unittest.TestCase):
    def test_shares(self):
        for (width, height, ratio), expected in CASES:
            self.assertEqual(tuple(round(value, 5) for value in bar_shares(width, height, ratio)), expected, (width, height, ratio))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
    def test_the_export_draws_sides_in_the_colour(self):
        with tempfile.TemporaryDirectory() as folder:
            steps, last, _ = finish_filters(Finish(letterbox=True, bars_ratio=4 / 3, bars_colour='#ff0000'), 320, 180, Path(folder), 'f', 'in')
            graph = f'color=c=0x2060a0:s=320x180:d=0.1,format=gbrp[in];' + ';'.join(steps)
            out = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'nullsrc=s=16x16:d=0.1', '-filter_complex', graph, '-map', f'[{last}]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
        frame = np.frombuffer(out, np.uint8).reshape(180, 320, 3)
        self.assertEqual(tuple(frame[90, 5]), (255, 0, 0))     # Inside the side bar: red.
        self.assertEqual(tuple(frame[90, 160]), (32, 96, 160))  # The picture between them.
        self.assertEqual(tuple(frame[2, 160]), (32, 96, 160))   # No bars above at 4:3 on a wide frame.


if __name__ == '__main__':
    unittest.main()
