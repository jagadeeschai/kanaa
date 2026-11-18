"""F2: an adjustment layer changes everything below it during its span, fading in and out, and nothing outside it."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import adjust_layer, gpu_render, render_window
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import AdjustItem, Timeline
from app.services.timeline_service import render_timeline

FPS = 30


def timeline(**span):
    return Timeline.model_validate({'format': {'width': 426, 'height': 240, 'fps': FPS}, 'layers': [
        {'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 6}]},
        {'id': 'grade', 'kind': 'adjust', 'items': [{'id': 'a', 'start': 2, 'length': 2, 'look': 'mono', 'fade_in': 0.5, 'fade_out': 0.5, **span}]}]})


class Strength(unittest.TestCase):
    def test_fades_in_and_out(self):
        item = AdjustItem(id='a', start=2, length=2, fade_in=0.5, fade_out=0.5)
        self.assertEqual([adjust_layer.strength(item, t) for t in (1.9, 2, 2.25, 3, 3.75, 4)], [0, 0, 0.5, 1, 0.5, 0])

    def test_short_span_fades_meet_in_the_middle(self):
        item = AdjustItem(id='a', start=0, length=1, fade_in=2, fade_out=2)
        self.assertEqual(adjust_layer.strength(item, 0.5), 1)

    def test_drawn_by_the_gpu_engine_unless_it_glows(self):
        facts = lambda _: MediaFacts(path=Path('p.png'), media_type='image', width=426, height=240)
        self.assertEqual(gpu_render.unsupported(timeline(), facts), [], 'graded on the GPU (test_gpu_adjust.py)')
        self.assertIn('glow on an adjustment layer', gpu_render.unsupported(timeline(dreamy_glow={'intensity': 0.5}), facts))

    def test_a_slice_cut_inside_a_fade_uses_the_whole(self):
        with self.assertRaises(render_window._Whole):
            render_window._slice(timeline(), 2.2, 6)
        cut = render_window._slice(timeline(), 2.6, 6)
        self.assertEqual(cut.layers[1].items[0].fade_in, 0)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Export(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp())
        picture = cls.root / 'p.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xd04020:s=320x180', '-frames:v', '1', str(picture)], check=True)
        cls.facts = {1: MediaFacts(path=picture, media_type='image', width=320, height=180)}
        cls.out = cls.root / 'out.mp4'
        with mock.patch.dict(os.environ, {'KANAA_PARALLEL_EXPORT': '0', 'KANAA_GPU_RENDER': '0'}):
            render_timeline(timeline(), cls.facts.__getitem__, lambda _: None, cls.out, lambda _: None, hardware=False)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def frame(self, t):
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t}', '-i', str(self.out), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                             capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(240, 426, 3)[80:160, 150:280].reshape(-1, 3).mean(0)

    def spread(self, t):
        r, g, b = self.frame(t)
        return max(r, g, b) - min(r, g, b)

    def test_only_the_span_is_graded_and_it_fades(self):
        before, fading, inside, after = self.spread(1.0), self.spread(2.25), self.spread(3.0), self.spread(5.0)
        self.assertGreater(before, 100)  # The red-orange picture, untouched.
        self.assertLess(inside, 8)  # Black and white.
        self.assertTrue(inside + 20 < fading < before - 20, (before, fading, inside))
        self.assertAlmostEqual(after, before, delta=6)


if __name__ == '__main__':
    unittest.main()
