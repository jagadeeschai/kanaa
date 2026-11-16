import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Timeline
from app.services.timeline_service import render_timeline

W, H = 426, 240
GREEN = (0, 177, 64)


def pictures(root: Path):
    """A warm sunset behind; in front, a cool grey figure shot on green, its soft edge tinted by the screen."""
    yy, xx = np.mgrid[:H, :W]
    sunset = np.stack([230 - yy * 0.2, 120 + yy * 0.25, 40 + xx * 0.05], 2).clip(0, 255).astype(np.uint8)
    Image.fromarray(sunset).save(root / 'back.png')
    shape = Image.new('L', (W, H)); ImageDraw.Draw(shape).ellipse((150, 40, 276, 260), fill=255)
    soft = np.asarray(shape.filter(ImageFilter.GaussianBlur(3))).astype(float)[..., None] / 255
    person = np.array([110, 120, 150], float)
    shot = (person * soft + np.array(GREEN, float) * (1 - soft)).clip(0, 255).astype(np.uint8)
    Image.fromarray(shot).save(root / 'front.png')
    return np.asarray(shape) > 0


def plan(composite=None):
    clip = {'id': 'front', 'media_id': 2, 'start': 0, 'in': 0, 'out': 1, 'chroma': {'color': '#00b140', 'similarity': .08, 'softness': .06, 'spill': .5}}
    if composite: clip['composite'] = composite
    return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': 24}, 'layers': [
        {'id': 'main', 'kind': 'video', 'items': [{'id': 'back', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1}]},
        {'id': 'top', 'kind': 'video', 'items': [clip]}]})


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
class Composite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory(); cls.root = Path(cls.folder.name); cls.inside = pictures(cls.root)
        cls.facts = {1: MediaFacts(path=cls.root / 'back.png', media_type='image', width=W, height=H), 2: MediaFacts(path=cls.root / 'front.png', media_type='image', width=W, height=H)}
        ring = Image.fromarray((cls.inside * 255).astype(np.uint8))
        outer = np.asarray(ring.filter(ImageFilter.MaxFilter(9))) > 0; inner = np.asarray(ring.filter(ImageFilter.MinFilter(9))) > 0
        cls.edge = outer & ~inner; cls.core = np.asarray(ring.filter(ImageFilter.MinFilter(41))) > 0

    @classmethod
    def tearDownClass(cls): cls.folder.cleanup()

    def frame(self, composite=None):
        target = Path(tempfile.mkdtemp(dir=self.root)) / 'out.mp4'
        render_timeline(plan(composite), self.facts.__getitem__, lambda _: None, target, lambda _: None, hardware=False)
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(float)

    def greenness(self, picture):
        band = picture[self.edge]; return float(np.clip(band[:, 1] - np.maximum(band[:, 0], band[:, 2]), 0, None).mean())

    def test_tightening_removes_the_green_fringe(self):
        plain, tight = self.frame(), self.frame({'choke': .5})
        self.assertLess(self.greenness(tight), self.greenness(plain) * .7)
        # The edge moves in: across the edge band, fewer pixels are still the figure's cool grey rather than the sunset.
        cool = lambda picture: int((picture[self.edge][:, 2] > picture[self.edge][:, 0]).sum())
        self.assertLess(cool(tight), cool(plain) * .85)
        self.assertLess(np.abs(tight[self.core] - plain[self.core]).mean(), 2)   # the middle of the figure is untouched

    def test_light_wrap_brings_the_background_into_the_edge_only(self):
        plain, wrapped = self.frame({'choke': .3}), self.frame({'choke': .3, 'wrap': 1})
        warm = lambda picture, where: float((picture[where][:, 0] - picture[where][:, 2]).mean())
        self.assertGreater(warm(wrapped, self.edge), warm(plain, self.edge) + 5)
        self.assertLess(np.abs(wrapped[self.core] - plain[self.core]).mean(), 2)

    def test_colour_match_moves_the_figure_toward_the_background(self):
        plain, matched = self.frame(), self.frame({'match': 1, 'match_gain': [1.3, 1.0, 0.7]})
        self.assertGreater(matched[self.core][:, 0].mean(), plain[self.core][:, 0].mean() * 1.2)
        self.assertLess(matched[self.core][:, 2].mean(), plain[self.core][:, 2].mean() * .8)
        outside = ~np.asarray(Image.fromarray((self.inside * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(15))) > 0
        self.assertLess(np.abs(matched[outside] - plain[outside]).mean(), 1.5)   # the background is not touched


    def test_measured_match_warms_a_cool_figure_on_a_sunset(self):
        from app.services.composite_match import measure
        render = lambda timeline, target, window: render_timeline(timeline, self.facts.__getitem__, lambda _: None, target, lambda _: None, hardware=False, window=window)
        red, green, blue = measure(plan(), 'front', .5, render)
        self.assertGreater(red, 1.1); self.assertLess(blue, .9)
        with self.assertRaises(ValueError): measure(plan(), 'back', .5, render)      # a main-track clip has nothing behind it


class ScreenColour(unittest.TestCase):
    def test_finds_an_even_green_or_blue_screen_and_nothing_else(self):
        from app.services.screen_colour import screen_colour
        def shot(back, noise=0):
            picture = np.zeros((H, W, 3)) + np.array(back, float)
            picture += np.random.default_rng(1).normal(0, noise, picture.shape)
            picture[60:240, 160:270] = (120, 110, 100)   # someone in front
            return Image.fromarray(picture.clip(0, 255).astype(np.uint8))
        self.assertTrue(screen_colour(shot(GREEN, 6)).startswith('#0'))
        blue = screen_colour(shot((20, 60, 200), 6)); self.assertIsNotNone(blue)
        self.assertIsNone(screen_colour(shot((128, 128, 128))))                   # a grey wall
        forest = np.random.default_rng(2).integers(0, 255, (H, W, 3)); forest[..., 1] = 160
        self.assertIsNone(screen_colour(Image.fromarray(forest.astype(np.uint8))))  # green, but not one even screen

if __name__ == '__main__': unittest.main()
