"""Shot-to-shot colour match: a clip matched to itself is unchanged; a warm hero makes it warmer and a dark one darker;
skin tones move less; brightness is never stretched too steeply; How strongly at 0 changes nothing; and the GPU frames
look like the CPU's."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import match_service as match
from app.services.media_probe import MediaFacts


def frames(bgr, noise=12, seed=0):
    rng = np.random.default_rng(seed)
    base = np.tile(np.array(bgr, np.float32), (4, 72, 128, 1))
    ramp = np.linspace(-60, 60, 128, dtype=np.float32)[None, None, :, None]
    return np.clip(base + ramp + rng.normal(0, noise, base.shape), 0, 255).astype(np.uint8)


class Cube(unittest.TestCase):
    def test_matched_to_itself_nothing_changes(self):
        shots = frames((120, 130, 140))
        cube = match.build_cube(shots, shots, {'amount': 1.0, 'skin': 0.0})
        out = match.apply_cube(shots[0], cube)
        self.assertLess(np.abs(out.astype(int) - shots[0].astype(int)).mean(), 3)

    def test_a_warm_hero_makes_it_warmer_a_dark_one_darker(self):
        cool, warm, dark = frames((150, 130, 110)), frames((90, 130, 180)), frames((50, 50, 55))
        warmed = match.apply_cube(cool[0], match.build_cube(warm, cool, {'skin': 0.0})).astype(float)
        self.assertGreater((warmed[..., 2] - warmed[..., 0]).mean(), (cool[0][..., 2].astype(float) - cool[0][..., 0]).mean() + 20)  # More red over blue (BGR).
        darker = match.apply_cube(cool[0], match.build_cube(dark, cool, {'skin': 0.0})).astype(float)
        self.assertLess(darker.mean(), cool[0].mean() - 20)

    def test_brightness_is_never_stretched_too_steeply(self):
        flat, punchy = frames((128, 128, 128), noise=2), frames((128, 128, 128), noise=60, seed=3)
        cube = match.build_cube(punchy, flat, {'skin': 0.0})
        grid = cube.reshape(match.CUBE, match.CUBE, match.CUBE, 3)
        greys = np.array([grid[k, k, k].mean() for k in range(match.CUBE)])
        self.assertLessEqual(np.diff(greys).max() * (match.CUBE - 1), match.STEEPEST + 0.15)

    def test_skin_moves_less_and_strength_zero_changes_nothing(self):
        skin = np.zeros((1, 8, 8, 3), np.uint8); skin[:] = (120, 150, 200)  # A warm mid skin tone (BGR).
        sky = np.zeros((1, 8, 8, 3), np.uint8); sky[:] = (200, 160, 120)
        blue_hero = frames((200, 120, 60))
        both = np.concatenate([np.repeat(skin, 4, 0), np.repeat(sky, 4, 0)], axis=2)
        cube = match.build_cube(blue_hero, both, {'skin': 1.0})
        moved = lambda pixel: np.abs(match.apply_cube(pixel[0], cube).astype(int) - pixel[0].astype(int)).mean()
        self.assertLess(moved(skin), moved(sky) * 0.5)
        untouched = match.build_cube(blue_hero, both, {'amount': 0.0})
        self.assertLess(np.abs(match.apply_cube(sky[0], untouched).astype(int) - sky[0].astype(int)).max(), 2)


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_match_looks_like_the_cpu_match(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip, hero = root / 'clip.mp4', root / 'hero.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=30', '-pix_fmt', 'yuv420p', str(clip)], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=30', '-vf', 'colorbalance=rs=0.3:gs=0.05:bs=-0.3,eq=contrast=1.2', '-pix_fmt', 'yuv420p', str(hero)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
            ref = MediaFacts(path=hero, media_type='video', width=640, height=360, duration=1, fps=30)
            made, used = {}, []
            with mock.patch.object(match.settings, 'data_dir', root):
                for mode in ('1', '0'):
                    with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(match, '_make', side_effect=lambda *a, real=match._make, **k: used.append((k['gpu'], real(*a, **k))) or used[-1][1]):
                        out = match.make(facts, 0, 1, ref, 0, 1)
                    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                    made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                    out.unlink()
            self.assertEqual(used, [(True, True), (False, True)])
            gpu, cpu = made['1'], made['0']
            psnr = 10 * np.log10(255 ** 2 / ((gpu - cpu) ** 2).mean())
            self.assertGreater(psnr, 32, psnr)
            self.assertGreater(gpu[..., 0].mean() - gpu[..., 2].mean(), -200)  # Sanity: real pictures came out.


if __name__ == '__main__':
    unittest.main()
