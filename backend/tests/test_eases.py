"""Bounce and Snap: the reference curve (preview and GPU) and the FFmpeg expression give the same values."""
import unittest

from app.services.timeline_schema import Transform, value_at
from app.services.timeline_service import ease_expression

SHIM = {'pow': pow, 'iff': lambda c, a, b: a if c else b, 'lt': lambda a, b: a < b, 'gte': lambda a, b: a >= b}


class EaseTest(unittest.TestCase):
    def test_reference_and_ffmpeg_agree(self):
        for ease in ('linear', 'easeOut', 'easeInOut', 'bounce', 'snap'):
            transform = Transform.model_validate({'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'keyframes': {'x': [{'t': 0, 'v': 0.2, 'ease': ease}, {'t': 2, 'v': 0.8}]}})
            for step in range(11):
                p = step / 10
                expected = value_at(transform, 'x', 2 * p) if p < 1 else 0.8
                curve = eval(ease_expression(ease, 'P').replace('if(', 'iff('), dict(SHIM), {'P': p})  # noqa: S307 — our own expression text.
                self.assertAlmostEqual(0.2 + 0.6 * curve, expected, places=6, msg=f'{ease} at {p}')

    def test_bounce_goes_past_then_settles_and_snap_darts(self):
        bounce = Transform.model_validate({'x': 0, 'y': 0, 'scale': 1, 'opacity': 1, 'keyframes': {'x': [{'t': 0, 'v': 0, 'ease': 'bounce'}, {'t': 1, 'v': 1}]}})
        self.assertGreater(max(value_at(bounce, 'x', step / 100) for step in range(100)), 1.05)
        snap = Transform.model_validate({'x': 0, 'y': 0, 'scale': 1, 'opacity': 1, 'keyframes': {'x': [{'t': 0, 'v': 0, 'ease': 'snap'}, {'t': 1, 'v': 1}]}})
        self.assertGreater(value_at(snap, 'x', 0.2), 0.7)


if __name__ == '__main__':
    unittest.main()
