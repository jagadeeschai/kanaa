"""The space around people that a title stays out of: steady, so letters at someone's edge don't flicker, never
behind someone walking, and never smaller than the person."""
import unittest

import numpy as np

from app.services.cutout_service import SteadySpace


def walking(frames: int, jitter: bool) -> list[np.ndarray]:
    """A person moving right 2 pixels a frame, whose outline wobbles a pixel or two, as Vision's does."""
    rng = np.random.default_rng(1)
    out = []
    for index in range(frames):
        frame = np.zeros((120, 200), np.uint8)
        x = 20 + 2 * index
        wobble = rng.integers(-2, 3, size=4) if jitter else np.zeros(4, int)
        frame[30 + wobble[0]:90 + wobble[1], x + wobble[2]:x + 30 + wobble[3]] = 255
        out.append(frame)
    return out


def steady(frames: list[np.ndarray], gap: int = 3, fps: float = 30) -> list[np.ndarray]:
    space = SteadySpace(gap, fps)
    out = []
    for frame in frames:
        out += space.push(frame)
    return out + space.finish()


def flicker(frames: list[np.ndarray]) -> int:
    """Pixels that change and change back within three frames."""
    on = [frame >= 128 for frame in frames]
    return sum(int(np.count_nonzero((on[i] != on[i - 1]) & ((on[i + 1] == on[i - 1]) | (on[i + 2] == on[i - 1]) | (on[i + 3] == on[i - 1]))))
               for i in range(1, len(on) - 3))


class SteadySpaceTest(unittest.TestCase):
    def test_one_frame_out_for_each_frame_in_and_in_order(self):
        frames = walking(40, jitter=False)
        out = steady(frames)
        self.assertEqual(len(out), len(frames))
        centres = [np.nonzero(frame.any(axis=0))[0].mean() for frame in out]
        self.assertTrue(all(later > earlier for earlier, later in zip(centres, centres[1:])))

    def test_the_person_is_always_inside_the_space(self):
        frames = walking(40, jitter=True)
        for person, space in zip(frames, steady(frames)):
            self.assertEqual(np.count_nonzero((person >= 128) & (space < 128)), 0)

    def test_space_does_not_lag_behind_someone_walking(self):
        frames = walking(40, jitter=False)
        out = steady(frames)
        for person, space in list(zip(frames, out))[10:30]:
            person_centre = np.nonzero(person.any(axis=0))[0].mean()
            space_centre = np.nonzero(space.any(axis=0))[0].mean()
            self.assertLess(abs(space_centre - person_centre), 1.5)

    def test_a_wobbling_outline_flickers_far_less(self):
        frames = walking(60, jitter=True)
        self.assertLess(flicker(steady(frames)), flicker(frames) / 4)

    def test_an_empty_clip_stays_empty(self):
        out = steady([np.zeros((50, 50), np.uint8)] * 12)
        self.assertEqual(len(out), 12)
        self.assertFalse(any(frame.any() for frame in out))


if __name__ == '__main__':
    unittest.main()
