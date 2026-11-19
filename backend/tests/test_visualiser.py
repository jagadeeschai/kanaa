"""Music visualiser: bands follow the music (bass low, treble high), styles draw in the colour, the video is made once."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import visualiser_service as viz


def tone(hz: float, seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * viz.RATE)) / viz.RATE
    return (0.5 * np.sin(2 * np.pi * hz * t)).astype(np.float32)


class VisualiserTest(unittest.TestCase):
    def test_bass_and_treble_light_their_own_bands(self):
        quiet = np.zeros(viz.RATE, np.float32)
        music = np.concatenate([quiet, tone(80, 1), tone(6000, 1)])  # Silence, then bass, then treble.
        level = viz.levels(music + np.random.default_rng(0).normal(0, 1e-4, music.size).astype(np.float32), 90)
        self.assertLess(level[20].max(), 0.2)
        bass, treble = level[55], level[85]
        self.assertGreater(bass[:12].max(), 0.8); self.assertLess(bass[30:].max(), 0.3)
        self.assertGreater(treble[36:].max(), 0.8); self.assertLess(treble[:12].max(), 0.3)

    def test_styles_draw_in_the_colour(self):
        level = np.full(viz.BANDS, 0.7, np.float32)
        for style in viz.STYLES:
            frame = viz.painter(style, (640, 360), viz.hex_colour('#ff2000'))(level)
            self.assertEqual((frame.shape, frame.dtype), ((360, 640, 3), np.uint8))
            lit = frame[frame.max(axis=2) > 60]
            self.assertGreater(len(lit), 500, style)
            self.assertGreater(lit[:, 0].mean(), lit[:, 2].mean() + 40, style)  # Red, not blue.
        with self.assertRaises(ValueError):
            viz.hex_colour('blue')

    @unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
    def test_makes_the_video_once(self):
        root = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, root)
        song = root / 'song.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', str(song)], check=True)
        with mock.patch.object(viz.settings, 'data_dir', root):
            made = viz.make(song, 1, 1.5, 'circle', '#7dd3fc', (1080, 1920))
            again = viz.make(song, 1, 1.5, 'circle', '#7dd3fc', (1080, 1920))
        self.assertEqual(made, again)
        probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', str(made)],
                                          capture_output=True, text=True).stdout)['streams'][0]
        self.assertEqual((probe['width'], probe['height'], int(probe['nb_read_frames'])), (1080, 1920, 45))


if __name__ == '__main__':
    unittest.main()
