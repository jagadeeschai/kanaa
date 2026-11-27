"""Fire overlays: listed with their Tamil names, light on black, the same picture for the same frame, flames and
firelight looping seamlessly over the 5 s effect, and the spark burst striking at once and gone before 2 s."""
import unittest

import numpy as np

from app.services import effect_service, fire_effects


class Fire(unittest.TestCase):
    SIZE = (320, 180)

    def frame(self, name, n):
        return np.asarray(fire_effects.PAINTERS[name](n, 150, self.SIZE).convert('RGB'), np.float32)

    def test_they_are_effects_with_tamil_names(self):
        ids = {effect.id: effect for effect in effect_service.EFFECTS}
        for name, _, tamil, _ in fire_effects.FIRE:
            self.assertIn(name, ids); self.assertEqual(ids[name].tamil, tamil)
            self.assertIs(effect_service.EFFECT_PAINTERS[name], fire_effects.PAINTERS[name])

    def test_the_same_frame_is_always_the_same_picture(self):
        for name in fire_effects.PAINTERS:
            self.assertEqual(np.abs(self.frame(name, 17) - self.frame(name, 17)).max(), 0, name)

    def test_flames_and_glow_loop_without_a_jump(self):
        for name in ('flames', 'fire-glow'):
            self.assertEqual(np.abs(self.frame(name, 0) - self.frame(name, round(fire_effects.LOOP * fire_effects.FPS))).max(), 0, name)
            self.assertGreater(np.abs(self.frame(name, 0) - self.frame(name, 12)).mean(), 0.2, f'{name} moves')

    def test_flames_burn_at_the_bottom_and_leave_the_top_dark(self):
        flames = self.frame('flames', 40)
        self.assertGreater(flames[-20:].mean(), 120)
        self.assertLess(flames[:60].mean(), 2)
        r, g, b = flames[-25:].reshape(-1, 3).mean(0)
        self.assertGreater(r, g); self.assertGreater(g, b)  # Fire colours: red over yellow over blue.

    def test_the_spark_burst_strikes_at_once_then_cools_away(self):
        self.assertGreater(self.frame('spark-burst', 1).max(), 200)
        self.assertGreater(self.frame('spark-burst', 15).max(), 60)
        self.assertEqual(self.frame('spark-burst', 70).max(), 0)


if __name__ == '__main__':
    unittest.main()
