"""3D moving pictures: what stands up out of the scene, and a camera move where near things move more than far ones."""
import unittest

import numpy as np

from app.services import depth_motion_service as d


def scene() -> np.ndarray:
    """Ground getting nearer towards the bottom, a far sky, and one person standing on the ground."""
    near = np.tile(np.linspace(0, 1, 120, dtype=np.float32)[:, None], (1, 160)) * 0.8
    near[:40] = 0.05
    near[40:110, 70:90] = 0.9
    return near


class DepthMotion(unittest.TestCase):
    def test_a_person_stands_out_and_the_ground_does_not(self):
        front = d.standing(scene())
        self.assertGreater(front[60:100, 74:86].mean(), 200, 'the person')
        self.assertLess(front[100:, :50].mean(), 10, 'the ground nearest the camera')
        self.assertLess(front[:30].mean(), 10, 'the sky')

    def test_near_things_move_more_than_far_ones_and_the_first_frame_is_the_picture(self):
        near = np.zeros((100, 200), np.float32)
        near[:, 100:] = 1
        move = d.MOVES['drift']
        start_x, _ = d.camera(near, move, 0.0, 1.0)
        end_x, _ = d.camera(near, move, 1.0, 1.0)
        shift = lambda column: abs(float(end_x[50, column] - start_x[50, column]))
        self.assertGreater(shift(150), shift(50) * 2, 'the near half slides further')
        x, y = d.camera(near, d.MOVES['push'], 0.0, 1.0)
        self.assertAlmostEqual(float(x[50, 30]), 30, places=3)
        self.assertAlmostEqual(float(y[20, 30]), 20, places=3)

    def test_the_push_starts_and_ends_gently(self):
        near = np.ones((10, 10), np.float32)
        at = lambda p: float(d.camera(near, d.MOVES['push'], p, 1.0)[0][0, 0])
        self.assertLess(abs(at(0.05) - at(0)), abs(at(0.55) - at(0.5)))

    @unittest.skipUnless(d.available(), 'the depth model is not on this machine')
    def test_the_model_sees_a_near_bright_box_on_a_far_wall(self):
        picture = np.full((240, 320, 3), 90, np.uint8)
        picture[:, :, 2] = 140
        picture[120:, :] = np.linspace(60, 200, 120, dtype=np.uint8)[:, None, None]
        near = d.depth_of(picture)
        self.assertEqual(near.shape, (240, 320))
        self.assertGreater(near[220:, :].mean(), near[:60, :].mean(), 'the floor near the bottom is nearer than the wall')


if __name__ == '__main__':
    unittest.main()
