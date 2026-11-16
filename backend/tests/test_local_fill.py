"""LaMa on this Mac: the square cut around the hole, and (when the model is installed) a real fill."""
import unittest

import numpy as np
from PIL import Image

from app.services import local_fill


class Square(unittest.TestCase):
    def test_square_has_room_and_stays_inside(self):
        mask = np.zeros((400, 600), bool); mask[100:200, 50:110] = True
        left, top, right, bottom = local_fill.square_around(mask)
        self.assertEqual(right - left, bottom - top)  # Square, as the model wants.
        self.assertTrue(left <= 50 and right >= 110 and top <= 100 and bottom >= 200)
        self.assertTrue(left >= 0 and top >= 0 and right <= 600 and bottom <= 400)
        edge = np.zeros((400, 600), bool); edge[380:400, 590:600] = True
        self.assertEqual(local_fill.square_around(edge)[2:], (600, 400))

    def test_no_hole_no_change(self):
        picture = Image.new('RGB', (64, 64), 'red')
        self.assertEqual(local_fill.fill(picture, Image.new('L', (64, 64)), run=lambda *_: 1 / 0).tobytes(), picture.convert('RGB').tobytes())


@unittest.skipUnless(local_fill.available(), 'needs the LaMa model in backend/.models/lama')
class RealModel(unittest.TestCase):
    def test_fills_a_hole_in_a_plain_sky_with_sky(self):
        sky = Image.new('RGB', (800, 600), (90, 150, 220))
        hole = Image.new('L', (800, 600)); hole.paste(255, (350, 200, 450, 400))
        punched = sky.copy(); punched.paste((255, 0, 255), (350, 200, 450, 400))  # Something bright where the hole is.
        filled = np.asarray(local_fill.fill(punched, hole)).astype(int)
        inside = filled[220:380, 370:430].reshape(-1, 3).mean(0)
        # The bright patch is gone and the hole is sky-coloured (LaMa drifts a little on a perfectly flat test colour).
        self.assertLess(np.abs(inside - [90, 150, 220]).max(), 40, inside)
        self.assertLess(np.abs(inside - [255, 0, 255]).min(), 255)
        self.assertGreater(np.abs(inside - [255, 0, 255]).max(), 120, inside)
        self.assertTrue((filled[:, :300] == np.asarray(punched)[:, :300]).all())  # Far from the hole: untouched.


if __name__ == '__main__':
    unittest.main()
