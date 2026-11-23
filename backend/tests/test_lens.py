"""Cinematic lens: what is at the focus distance stays exactly sharp, what is far from it blurs, the focus moves
smoothly for a rack focus, and the link to the original validates."""
import unittest

import numpy as np

from app.services import lens_service as lens
from app.services.timeline_schema import Clip


def sharpness(image: np.ndarray) -> float:
    gray = image.mean(axis=2)
    return float(np.abs(np.diff(gray, axis=1)).mean())


class Lens(unittest.TestCase):
    def test_in_focus_sharp_out_of_focus_soft(self):
        rng = np.random.default_rng(0)
        frame = rng.integers(0, 255, (360, 640, 3), dtype=np.uint8)  # Fine detail everywhere.
        near = np.zeros((360, 640), np.float32); near[:, :320] = 0.65; near[:, 320:] = 0.05  # Left at the focus, right far.
        out = lens.lens_frame(frame, near, 0.65, 1.0, False)
        self.assertTrue(np.array_equal(out[:, :280], frame[:, :280]))  # In focus: untouched.
        self.assertLess(sharpness(out[:, 380:]), sharpness(frame[:, 380:]) * 0.3)  # Far: much softer.

    def test_rack_focus_moves_smoothly(self):
        focus, amount, glow = lens.plan('rack-out', 'medium', 5.0)
        values = [lens.focus_at(focus, t / 10) for t in range(51)]
        self.assertAlmostEqual(values[0], 0.82); self.assertAlmostEqual(values[-1], 0.12)
        self.assertTrue(all(b <= a + 1e-9 for a, b in zip(values, values[1:])))
        self.assertEqual(lens.plan('dreamy', 'strong', 3)[1:], (lens.STRENGTH['strong'] * lens.PRESETS['dreamy'], True))

    def test_link_validates(self):
        clip = Clip.model_validate({'id': 'a', 'media_id': 9, 'start': 0, 'in': 0, 'out': 3, 'lens': {'original_media_id': 4, 'original_in': 2, 'original_out': 5, 'preset': 'rack-in'}})
        self.assertEqual(clip.lens.original_media_id, 4)


if __name__ == '__main__':
    unittest.main()
