"""Video inside the words: the title becomes a full card in its colour with the letters cut out (one picture for the
preview, the GPU and FFmpeg), and a knockout title gets its own cached picture."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from app.api.timeline_routes import text_cache
from app.services.timeline_schema import Format, Text
from app.services.timeline_service import render_text_image

FMT = Format.model_validate({'width': 640, 'height': 360, 'fps': 30})


def title(**extra):
    return Text.model_validate({'id': 'a', 'start': 0, 'length': 3, 'text': 'கனா KANAA', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 100, **extra})


class KnockoutTest(unittest.TestCase):
    def test_letters_become_holes_in_a_card(self):
        with tempfile.TemporaryDirectory() as folder:
            plain, card = Path(folder) / 'plain.png', Path(folder) / 'card.png'
            render_text_image(title(), FMT, plain)
            render_text_image(title(knockout='#102030'), FMT, card)
            letters = np.asarray(Image.open(plain).convert('RGBA'))[..., 3].astype(int)
            made = np.asarray(Image.open(card).convert('RGBA'))
        self.assertTrue(np.array_equal(made[..., 3].astype(int), 255 - letters))
        self.assertEqual(tuple(made[0, 0, :3]), (0x10, 0x20, 0x30))
        self.assertGreater((made[..., 3] < 20).mean(), 0.01)  # There are holes.
        self.assertEqual(made[0, 0, 3], 255)  # The corners are covered.

    def test_cached_apart_from_the_plain_title(self):
        self.assertNotEqual(text_cache(title(), FMT), text_cache(title(knockout='#000000'), FMT))
        with self.assertRaises(Exception):
            title(knockout='black')


if __name__ == '__main__':
    unittest.main()
