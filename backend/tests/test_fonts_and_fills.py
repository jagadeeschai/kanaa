"""Your own fonts (added, listed, drawn by libass, removed) and letter fills (gold, gradient, picture) that keep the
outline. Titles are one picture for the preview, the GPU and FFmpeg, so testing the picture tests all three."""
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

from app.services import font_service
from app.services.timeline_schema import Format, Text
from app.services.timeline_service import render_text_image

SYSTEM_FONT = Path('/System/Library/Fonts/Supplemental/Chalkduster.ttf')
FMT = Format.model_validate({'width': 640, 'height': 360, 'fps': 30})


def title(**extra):
    return Text.model_validate({'id': 'a', 'start': 0, 'length': 3, 'text': 'KANAA', 'style': 'outline', 'position': 'center', 'color': '#ffffff', 'size': 90, **extra})


def draw(item) -> np.ndarray:
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / 't.png'
        render_text_image(item, FMT, target)
        return np.asarray(Image.open(target).convert('RGBA')).astype(int)


class OwnFontsTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.root)
        patch = mock.patch.object(font_service.settings, 'data_dir', self.root); patch.start(); self.addCleanup(patch.stop)

    def test_checks_the_file(self):
        with self.assertRaisesRegex(ValueError, '.ttf or .otf'):
            font_service.add_font('x.zip', b'PK')
        with self.assertRaisesRegex(ValueError, 'not a font'):
            font_service.add_font('x.ttf', b'not a font at all')
        with self.assertRaisesRegex(ValueError, 'already has'):
            font_service.add_font('Arima.ttf', (font_service.LYRIC_FONTS_DIR / 'Arima-Bold.ttf').read_bytes())

    @unittest.skipUnless(SYSTEM_FONT.is_file(), 'needs a Mac system font to add')
    def test_added_font_is_listed_drawn_and_removed(self):
        added = font_service.add_font('chalk.ttf', SYSTEM_FONT.read_bytes())
        self.assertEqual((added['family'], added['latin'], added['tamil']), ('Chalkduster', True, False))
        self.assertEqual([font['family'] for font in font_service.own_fonts()], ['Chalkduster'])
        self.assertTrue((font_service.fonts_dir() / added['file']).is_file())
        self.assertTrue((font_service.fonts_dir() / 'Arima-Bold.ttf').is_file())
        self.assertEqual(font_service.font_file(added['file']), font_service.own_dir() / added['file'])
        self.assertIsNone(font_service.font_file('../secret.ttf'))
        font_service.remove_font(added['file'])
        self.assertEqual(font_service.own_fonts(), [])
        self.assertFalse((font_service.fonts_dir() / added['file']).exists())


class FillTest(unittest.TestCase):
    def test_gold_and_gradient_fill_the_letters_and_keep_the_outline(self):
        plain = draw(title())
        body = (plain[..., :3].min(axis=2) > 240) & (plain[..., 3] > 240)
        outline = (plain[..., :3].max(axis=2) < 30) & (plain[..., 3] > 240)
        gold = draw(title(fill={'kind': 'gold'}))
        self.assertTrue(np.array_equal(gold[..., 3], plain[..., 3]))  # Same shape: only the colour inside changes.
        self.assertGreater(gold[body][:, 0].mean() - gold[body][:, 2].mean(), 60)  # Warm.
        self.assertLessEqual(np.abs(gold[outline] - plain[outline]).max(), 3)  # The outline is untouched.
        ramp = draw(title(fill={'kind': 'gradient', 'colours': ['#ff0000', '#0000ff']}))
        rows = np.nonzero(body.any(axis=1))[0]
        top, bottom = ramp[rows[0] + 2][body[rows[0] + 2]], ramp[rows[-1] - 2][body[rows[-1] - 2]]
        self.assertGreater(top[:, 0].mean(), top[:, 2].mean())
        self.assertGreater(bottom[:, 2].mean(), bottom[:, 0].mean())


if __name__ == '__main__':
    unittest.main()
