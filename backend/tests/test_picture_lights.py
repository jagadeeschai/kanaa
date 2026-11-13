import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from app.services import sky_light_service
from kanaa_mcp import picture_lights


def picture(folder, night=True, moon=True):
    image = np.zeros((600, 900, 3), np.uint8)
    image[:] = (90, 40, 15) if night else (235, 200, 150)  # BGR: deep night blue, or a pale day sky.
    image[360:] = (20, 60, 30) if night else (40, 140, 60)  # Ground.
    for x in range(0, 900, 60):  # A row of textured trees along the ground.
        cv2.circle(image, (x, 360), 40, (10, 50, 20), -1)
        cv2.circle(image, (x + 10, 350), 12, (60, 120, 70), 2)
    if moon:
        cv2.circle(image, (700, 120), 22, (245, 250, 255), -1)
    path = Path(folder) / f'{night}-{moon}.png'
    cv2.imwrite(str(path), image)
    return path


class Analyze(unittest.TestCase):
    def test_a_night_sky_and_its_moon_are_found(self):
        with tempfile.TemporaryDirectory() as folder:
            found = sky_light_service.analyze(picture(folder))
            self.assertTrue(found['night'])
            self.assertAlmostEqual(found['moon'][0], 700 / 900, delta=0.02)
            self.assertAlmostEqual(found['moon'][1], 120 / 600, delta=0.02)
            self.assertGreater(found['sky'], 0.3)

    def test_day_pictures_are_left_alone(self):
        with tempfile.TemporaryDirectory() as folder:
            found = sky_light_service.analyze(picture(folder, night=False, moon=False))
            self.assertFalse(found['night'])
            self.assertTrue(found['reason'])

    def test_a_night_sky_without_a_moon_still_twinkles(self):
        with tempfile.TemporaryDirectory() as folder:
            found = sky_light_service.analyze(picture(folder, moon=False))
            self.assertTrue(found['night'])
            self.assertIsNone(found['moon'])


class Lamps(unittest.TestCase):
    def test_lamps_glow_at_night_and_daylight_is_left_alone(self):
        from app.services import lamp_glow_service, picture_lights_service
        with tempfile.TemporaryDirectory() as folder:
            image = np.full((600, 900, 3), (25, 30, 40), np.uint8)  # A dim room.
            for x in (200, 450, 700):
                cv2.circle(image, (x, 400), 7, (120, 220, 255), -1)  # Flames: warm and as bright as it gets.
                cv2.circle(image, (x, 400), 3, (200, 255, 255), -1)
            night = Path(folder) / 'lamps.png'; cv2.imwrite(str(night), image)
            self.assertEqual(len(lamp_glow_service.analyze(night)['lamps']), 3)
            day = Path(folder) / 'day.png'; cv2.imwrite(str(day), np.clip(image.astype(int) + 150, 0, 255).astype(np.uint8))
            self.assertEqual(lamp_glow_service.analyze(day)['lamps'], [])
            both = picture_lights_service.analyze(night)
            self.assertIsNone(both['sky']); self.assertEqual(len(both['lamps']), 3); self.assertNotIn('reason', both)
            draw = lamp_glow_service.painter(night, 3, (450, 300))
            a, b = draw(0.3), draw(1.1)
            self.assertGreater(float(a[200, 100].max()), 0.2, 'a lamp glows')
            self.assertNotAlmostEqual(float(a[200, 100, 0]), float(b[200, 100, 0]), places=3, msg='and flickers')


class OverShots(unittest.TestCase):
    def test_sky_pieces_follow_each_shot_and_skip_day_pictures(self):
        shot = lambda id_, media, start, length, scale: {'id': id_, 'media_id': media, 'start': start, 'in': 0, 'out': length, 'speed': 1,
                                                         'transform': {'x': 0.5, 'y': 0.5, 'scale': scale, 'opacity': 1, 'rotation': 0, 'keyframes': {'scale': [{'t': 0, 'v': scale}, {'t': length, 'v': scale * 1.1}]}}}
        timeline = {'layers': [{'id': 'main', 'kind': 'video', 'items': [shot('lyric-scene-1', 5, 0, 8, 1), shot('lyric-scene-1-2', 99, 8, 8, 1.35), shot('lyric-scene-2', 6, 16, 8, 1)]}]}
        asked = []
        made = picture_lights.add(timeline, lambda picture, seconds: asked.append((picture, seconds)) or (77 if picture == 5 else None))
        self.assertEqual(asked, [(5, 16), (6, 8)], 'asked once per picture, for all its shots together')
        self.assertEqual(made, [77])
        layer = timeline['layers'][1]
        self.assertEqual((layer['blend'], [p['in'] for p in layer['items']]), ('screen', [0, 8]))
        self.assertEqual(layer['items'][1]['transform']['scale'], 1.35, 'the medium shot zooms the sky with it')


if __name__ == '__main__':
    unittest.main()
