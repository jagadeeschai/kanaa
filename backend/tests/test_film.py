"""Film physics: halation glows warm around bright highlights and leaves the dark alone; handheld shake moves smoothly,
the same every time, never shows the frame's edges, and an impact settles; and the GPU frames look like the CPU's."""
import math
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import film_service as film
from app.services.media_probe import MediaFacts


class Halation(unittest.TestCase):
    def test_bright_highlights_glow_warm_the_dark_stays(self):
        frame = np.full((180, 320, 3), 30, np.uint8); frame[80:100, 150:170] = 255  # One bright light in the dark.
        out = film.halation_frame(frame, film.HALATION['classic']).astype(int)
        ring = out[70:80, 150:170]  # Just outside the light.
        self.assertGreater(ring[..., 2].mean(), 30 + 15)  # Glows...
        self.assertGreater(ring[..., 2].mean() - ring[..., 0].mean(), 10)  # ...warm (red over blue, BGR).
        self.assertLess(np.abs(out[:30, :60] - 30).max(), 2)  # Far dark corners untouched.
        weaker = film.halation_frame(frame, film.HALATION['subtle']).astype(int)[70:80, 150:170, 2].mean()
        self.assertLess(weaker, ring[..., 2].mean())


class Shake(unittest.TestCase):
    def test_smooth_repeatable_edges_never_show(self):
        path = film.shake_path(film.SHAKE['docu'], 90, 30, seed=7)
        self.assertEqual(path, film.shake_path(film.SHAKE['docu'], 90, 30, seed=7))  # The same every time.
        steps = [abs(b[0] - a[0]) for a, b in zip(path, path[1:])]
        self.assertLess(max(steps), 0.002)  # Smooth: no jumps from frame to frame.
        import cv2
        width, height = 320, 180
        for preset in film.SHAKE:  # Every corner of the picture shown comes from inside the clip's own picture.
            for across, down, turn, zoom in film.shake_path(film.SHAKE[preset], 90, 30, seed=3, aspect=height / width):
                matrix = cv2.getRotationMatrix2D(((width - 1) / 2, (height - 1) / 2), turn, zoom)
                matrix[0, 2] += across * width; matrix[1, 2] += down * width
                back = cv2.invertAffineTransform(matrix)
                for x, y in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
                    sx, sy = back @ np.array([x, y, 1.0])
                    self.assertTrue(-0.5 <= sx <= width - 0.5 and -0.5 <= sy <= height - 0.5, (preset, sx, sy))

    def test_impact_settles_and_amount_scales(self):
        impact = film.shake_path(film.SHAKE['impact'], 60, 30, seed=1)
        self.assertGreater(max(abs(p[0]) for p in impact[:5]), 4 * max(abs(p[0]) for p in impact[-10:]))
        big = film.shake_path({**film.SHAKE['docu'], 'amount': 2.0}, 90, 30, seed=7)
        self.assertGreater(max(abs(p[0]) for p in big), 1.5 * max(abs(p[0]) for p in film.shake_path(film.SHAKE['docu'], 90, 30, seed=7)))
        with self.assertRaises(ValueError):
            film.make(MediaFacts(path=Path('x.mp4'), media_type='video'), 0, 1, 'shake', 'earthquake')


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_film_looks_look_like_the_cpu_ones(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip = root / 'clip.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=30', '-pix_fmt', 'yuv420p', str(clip)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
            for kind, preset in (('halation', 'dreamy'), ('shake', 'impact')):
                made, used = {}, []
                with mock.patch.object(film.settings, 'data_dir', root):
                    for mode in ('1', '0'):
                        with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(film, '_make', side_effect=lambda *a, real=film._make, **k: used.append((k['gpu'], real(*a, **k))) or used[-1][1]):
                            out = film.make(facts, 0, 1, kind, preset)
                        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                        made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                        out.unlink()
                self.assertEqual(used, [(True, True), (False, True)], kind)
                gpu, cpu = made['1'], made['0']
                psnr = 10 * np.log10(255 ** 2 / ((gpu - cpu) ** 2).mean())
                # 28 dB for shake on this razor-sharp test pattern: moving a picture by fractions of a pixel samples hard
                # edges a little differently in the two engines (as the time freeze).
                self.assertGreater(psnr, 28 if kind == 'shake' else 30, (kind, psnr))


if __name__ == '__main__':
    unittest.main()


class ShakeSeed(unittest.TestCase):
    def test_each_part_wobbles_its_own_way_and_the_same_part_the_same(self):
        from app.services.film_service import seed_of
        self.assertEqual(seed_of(4, 2.0, 4.0), seed_of(4, 2.0, 4.0))
        self.assertNotEqual(seed_of(4, 2.0, 4.0), seed_of(4, 6.0, 8.0))  # Same length, another cut.
        self.assertNotEqual(seed_of(4, 2.0, 4.0), seed_of(5, 2.0, 4.0))
