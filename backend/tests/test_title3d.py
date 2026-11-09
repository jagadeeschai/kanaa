"""Titles in 3D: the export's corner maths, kept in step with frontend/src/timeline/title3d.ts through a shared fixture."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

from app.services import title3d

ROOT = Path(__file__).resolve().parents[2]


class Title3d(unittest.TestCase):
    def test_the_shared_fixture_is_what_this_maths_gives(self):
        """frontend/tests/title3d.test.mjs checks the preview against this file; here the export is checked against it too."""
        fresh = json.loads(subprocess.run([sys.executable, str(ROOT / 'tools' / 'title3d_fixture.py')], capture_output=True, text=True, check=True).stdout)
        saved = json.loads((ROOT / 'frontend' / 'tests' / 'title3d-cases.json').read_text())
        for got, want in zip(fresh['cases'], saved['cases']):
            for (gx, gy), (wx, wy) in zip(got['corners'], want['corners']):
                self.assertAlmostEqual(gx, wx, places=6)
                self.assertAlmostEqual(gy, wy, places=6)
        self.assertEqual(len(fresh['looks']), len(saved['looks']))

    def test_a_flat_pose_puts_the_box_exactly_where_the_flat_title_goes(self):
        pose = {'cx': .5, 'cy': .5, 'size': 1, 'turn': 0, 'tilt_x': 0, 'tilt_y': 0}
        self.assertEqual([tuple(round(v, 9) for v in p) for p in title3d.corners(pose, (100, 50, 300, 80), (640, 360))], [(100, 50), (300, 50), (300, 80), (100, 80)])

    def test_leaning_back_brings_the_top_in_and_up(self):
        pose = {'cx': .5, 'cy': .5, 'size': 1, 'turn': 0, 'tilt_x': 50, 'tilt_y': 0}
        (tlx, tly), (trx, _), (brx, bry), (blx, _) = title3d.corners(pose, (200, 150, 440, 210), (640, 360))
        self.assertLess(trx - tlx, brx - blx, 'the far edge is shorter')
        self.assertLess(bry - tly, 60, 'the lean shortens it')

    def test_depth_layers_step_back_and_get_darker(self):
        depth = type('Depth', (), {'amount': 1, 'light': .8})()
        shares = title3d.layers(depth)
        self.assertEqual(len(shares), title3d.MAX_LAYERS)
        self.assertGreater(title3d.layer_shade(depth, shares[1]), title3d.layer_shade(depth, shares[-1]))

    def test_the_homography_maps_the_four_points(self):
        source = [(0, 0), (10, 0), (10, 5), (0, 5)]
        target = [(3, 1), (14, 2), (12, 9), (1, 7)]
        h = title3d.homography(source, target)
        for (x, y), (u, v) in zip(source, target):
            w = h[2][0] * x + h[2][1] * y + h[2][2]
            self.assertAlmostEqual((h[0][0] * x + h[0][1] * y + h[0][2]) / w, u)
            self.assertAlmostEqual((h[1][0] * x + h[1][1] * y + h[1][2]) / w, v)


class PictureTricks(unittest.TestCase):
    """Enter and exit picture tricks combine as pictureLook in animation.ts (the same cases as title-moves.test.mjs)."""

    def test_enter_and_exit_tricks_combine_as_in_the_preview(self):
        from app.services.animation import PICTURE_REST, picture_look
        from app.services.timeline_schema import Animation
        self.assertEqual(picture_look({}, {}), PICTURE_REST)
        both = title3d.animated_look(Animation(preset='reveal', duration=1), Animation(preset='line', duration=1), 0.5, 4)
        self.assertTrue(0.8 < both['reveal'] < 1)
        self.assertEqual(both['line'], 1)
        copies = title3d.animated_look(Animation(preset='chromatic', duration=1), Animation(preset='echo', duration=1), 3.9, 4)
        self.assertEqual(copies['trick'], 3)

    def test_picture_animations_go_through_the_3d_path(self):
        from app.services.timeline_schema import Text
        for preset in ('reveal', 'soft-edge', 'line', 'chromatic', 'prism', 'echo'):
            self.assertTrue(title3d.is_3d(Text.model_validate({'id': 't', 'start': 0, 'length': 2, 'text': 'Hi', 'enter': {'preset': preset, 'duration': 1}})), preset)
