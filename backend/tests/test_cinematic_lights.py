import unittest
import numpy as np
from app.services.cinematic_lights import LIGHTS, PAINTERS
from app.services import effect_service

class CinematicLights(unittest.TestCase):
    def test_catalogue_and_deterministic_seeking(self):
        for id, label, tamil, about in LIGHTS:
            self.assertIn(id, effect_service.BY_ID)
            self.assertTrue(label and tamil and about)
            paint = PAINTERS[id]
            frames = [np.asarray(paint(n, 150, (160, 90), np.random.default_rng(4))) for n in (3, 30, 75, 120)]
            self.assertGreater(max(int(f.max()) for f in frames), 60, id)
            self.assertTrue(all(f.shape == (90, 160, 3) and f.dtype == np.uint8 for f in frames))
            self.assertGreater(max(np.abs(frames[0].astype(float)-f).mean() for f in frames[1:]), .1, id)
            np.testing.assert_array_equal(frames[2], paint(75, 150, (160, 90), np.random.default_rng(999)))

    def test_bloom_hits_once_and_sweep_crosses_frame(self):
        paint = PAINTERS['bloom-hit']
        def energy(n): return np.asarray(paint(n, 150, (160,90), None)).mean()
        self.assertEqual(energy(0), 0)
        self.assertGreater(energy(2), 30)
        self.assertLess(energy(30), 1)
        self.assertEqual(energy(149), 0)
        paint = PAINTERS['frame-light-sweep']
        centres=[]
        for n in (35, 75, 110):
            frame=np.asarray(paint(n,150,(160,90),None),float).sum(axis=(0,2))
            centres.append(float(np.dot(frame,np.arange(160))/frame.sum()))
        self.assertLess(centres[0],centres[1]); self.assertLess(centres[1],centres[2])
