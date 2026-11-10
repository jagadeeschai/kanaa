import math
import unittest

import numpy as np

from app.services.surface_service import _surface, surface_at
from app.services.title3d import corners


def grid_on_plane(pose: dict, size=(1280, 720), cells=12) -> np.ndarray:
    """A picture of a tiled surface: a square grid drawn where title3d puts a title with `pose`, so the true tilt is known."""
    import cv2
    width, height = size
    tile = np.full((1200, 1200, 3), 70, np.uint8)
    for i in range(cells + 1):
        at = round(i * 1199 / cells)
        cv2.line(tile, (at, 0), (at, 1199), (235, 235, 235), 7)
        cv2.line(tile, (0, at), (1199, at), (235, 235, 235), 7)
    # A 1200-pixel square about the frame's middle, through the same camera a title in this frame is seen with.
    box = (width / 2 - 600, height / 2 - 600, width / 2 + 600, height / 2 + 600)
    target = np.float32(corners({**pose, 'size': 1.0}, box, size))
    source = np.float32([[0, 0], [1200, 0], [1200, 1200], [0, 1200]])
    matrix = cv2.getPerspectiveTransform(source, target)
    return cv2.warpPerspective(tile, matrix, size, borderValue=(30, 30, 30))


class Surface(unittest.TestCase):
    def test_finds_the_tilt_a_tiled_surface_was_drawn_with(self):
        for tilt_x, tilt_y, turn in ((50, 0, 0), (0, 40, 0), (35, -30, 0), (-45, 20, 0), (20, 0, 15)):
            with self.subTest(tilt_x=tilt_x, tilt_y=tilt_y, turn=turn):
                pose = {'cx': 0.5, 'cy': 0.5, 'turn': turn, 'tilt_x': tilt_x, 'tilt_y': tilt_y}
                # The general rule, any two directions: exact on any tiled surface (the named kinds narrow it down).
                found = _surface(grid_on_plane(pose), 0.5, 0.5, None)
                self.assertTrue(found['found'], found)
                for key, wanted in (('tilt_x', tilt_x), ('tilt_y', tilt_y), ('turn', turn)):
                    self.assertAlmostEqual(found[key], wanted, delta=4, msg=f'{key}: {found}')

    def test_no_edges_or_sky_means_upright(self):
        plain = np.full((720, 1280, 3), 120, np.uint8)
        self.assertFalse(surface_at(plain, 0.5, 0.5)['found'])
        sky = np.zeros((720, 1280), bool); sky[:300] = True
        self.assertEqual(surface_at(plain, 0.5, 0.2, sky)['kind'], 'sky')

    def test_a_named_surface_uses_its_own_lines_or_its_default(self):
        # A level floor, the path running away a little to one side: the lettering lies square across it.
        floor = grid_on_plane({'cx': 0.5, 'cy': 0.5, 'turn': 12, 'tilt_x': 55, 'tilt_y': 0})
        found = surface_at(floor, 0.5, 0.5, kind='floor')
        self.assertTrue(found['found']); self.assertAlmostEqual(found['tilt_x'], 55, delta=5)
        self.assertAlmostEqual(found['tilt_y'], 0, delta=3); self.assertAlmostEqual(abs(found['turn']), 12, delta=5)
        wall = grid_on_plane({'cx': 0.5, 'cy': 0.5, 'turn': 0, 'tilt_x': 0, 'tilt_y': -35})
        found = surface_at(wall, 0.5, 0.5, kind='wall')
        self.assertTrue(found['found']); self.assertAlmostEqual(found['tilt_y'], -35, delta=5); self.assertAlmostEqual(found['tilt_x'], 0, delta=5)
        plain = np.full((720, 1280, 3), 120, np.uint8)
        self.assertEqual(surface_at(plain, 0.5, 0.5, kind='floor')['tilt_x'], 62.0, 'no lines: the floor default')
        self.assertEqual(surface_at(floor, 0.5, 0.5, kind='upright')['tilt_x'], 0.0, 'upright is never tilted')


if __name__ == '__main__':
    unittest.main()
