"""The brand intro: made from a logo's own parts, the leaf plain while it falls and its cut-out only after the strike."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

from app.core.config import settings
from app.services import brand_intro_service as intro


def logo(folder: Path) -> Path:
    """A leaf (a big gold oval with a hole cut in it) above a line of lettering, on a transparent background."""
    im = Image.new('RGBA', (600, 400), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    draw.ellipse((220, 20, 380, 220), fill=(240, 180, 60, 255))
    draw.ellipse((285, 90, 315, 150), fill=(0, 0, 0, 0))  # The cut-out, like the note.
    draw.rectangle((100, 260, 500, 300), fill=(240, 180, 60, 255))
    path = folder / 'logo.png'
    im.save(path)
    return path


class BrandIntro(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.patch = patch.object(settings, 'data_dir', self.folder)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()

    def test_the_leaf_falls_plain_and_its_cut_out_appears_after_the_strike(self):
        made = intro.Intro(logo(self.folder), 320, 180, 'வழங்கும்', 'PRESENTS')
        hole = np.array(made.leaf)[..., 3]
        plain = np.array(made.plain)[..., 3]
        self.assertGreater((plain > 200).sum(), (hole > 200).sum(), 'the plain leaf has its cut-out filled')
        start, end = made.frame(0.1), made.frame(4.5)
        self.assertLess(start.mean(), end.mean(), 'the logo and words are there by the end')
        self.assertEqual(made.frame(intro.SECONDS - 0.01).max() < 30, True, 'it fades to black')

    def test_made_once_and_kept(self):
        path = logo(self.folder)
        first = intro.make(path, 320, 180)
        self.assertTrue(first.is_file())
        mtime = first.stat().st_mtime
        self.assertEqual(intro.make(path, 320, 180), first)
        self.assertEqual(first.stat().st_mtime, mtime, 'not made twice')
        self.assertNotEqual(intro.intro_path(path, 320, 180, 'வழங்கும்', 'PRESENTS'), intro.intro_path(path, 320, 180, 'வழங்கும்', ''))

    def test_a_logo_without_transparency_is_refused(self):
        path = self.folder / 'flat.png'
        Image.new('RGB', (200, 100), (200, 50, 50)).save(path)
        with self.assertRaises(ValueError):
            intro.Intro(path, 320, 180, 'x', 'y')


if __name__ == '__main__':
    unittest.main()
