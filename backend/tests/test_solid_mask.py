"""The person mask a title hides behind: solid (no half see-through people) and steady (no one-frame pops)."""
import unittest

import numpy as np

from app.services.cutout_service import HOLD_SECONDS, Steadier


def person(x: int, width: int = 20, height: int = 40, shade: int = 200) -> np.ndarray:
    frame = np.zeros((60, 80), np.uint8)
    frame[10:10 + height, x:x + width] = shade
    return frame


def run(frames, fps=30):
    steady = Steadier(radius=0, fps=fps)
    steady.firm = lambda mask: mask
    out = []
    for frame in frames:
        out += steady.push(frame)
    return out + steady.finish()


class SolidMask(unittest.TestCase):
    def test_only_fully_on_or_off(self):
        # A faint, half-confident person becomes fully the person; a fainter aura is dropped.
        out = run([np.maximum(person(10, shade=140), person(50, shade=60))])[0]
        self.assertEqual(set(np.unique(out)), {0, 255})
        self.assertTrue((out[10:50, 10:30] == 255).all())
        self.assertFalse(out[:, 50:70].any())

    def test_holes_inside_a_person_are_filled(self):
        frame = person(10)
        frame[25:29, 18:22] = 0
        self.assertTrue((run([frame])[0][25:29, 18:22] == 255).all())

    def test_a_short_blink_is_bridged(self):
        frames = [person(10)] * 3 + [np.zeros((60, 80), np.uint8)] * 4 + [person(10)] * 3
        self.assertTrue(all(out[30, 20] == 255 for out in run(frames)))

    def test_a_real_exit_is_not_held_for_long(self):
        hold = round(HOLD_SECONDS * 30)
        out = run([person(10)] * 3 + [np.zeros((60, 80), np.uint8)] * (hold + 5))
        self.assertFalse(out[-1].any())

    def test_walking_leaves_no_trail(self):
        # Moving right a pixel a frame: the place they left is empty straight away.
        out = run([person(10 + k) for k in range(10)])
        self.assertFalse(out[-1][:, 10:19].any())
        self.assertTrue((out[-1][10:50, 19:39] == 255).all())


if __name__ == '__main__':
    unittest.main()
