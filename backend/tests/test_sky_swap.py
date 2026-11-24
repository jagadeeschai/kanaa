"""Sky swap: the sky is found where the clip is farthest and its edge follows the picture, the new skies are drawn
with their horizon where the clip's is, the camera is followed by the far land, the land takes the new sky's light,
and the GPU frames look like the CPU's."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import sky_swap_service as sky
from app.services.media_probe import MediaFacts


class Sky(unittest.TestCase):
    def test_the_sky_is_the_farthest_part_and_its_horizon_is_found(self):
        frame = np.zeros((90, 160, 3), np.uint8); frame[:30] = (230, 200, 160); frame[30:] = (40, 120, 40)
        near = np.zeros((90, 160), np.float32); near[30:] = 0.4
        mask = sky.sky_mask(frame, near)
        self.assertGreater(mask[:25].mean(), 0.9); self.assertLess(mask[35:].mean(), 0.05)
        self.assertAlmostEqual(sky.horizon_of(mask), 30 / 90, delta=0.04)
        self.assertIsNone(sky.horizon_of(np.zeros((90, 160), np.float32)))  # No sky: none.

    def test_skies_are_drawn_with_the_glow_at_the_horizon(self):
        for name in sky.SKIES:
            picture = sky.paint_sky(name, 320, 180, horizon=0.4).astype(float)
            self.assertEqual(picture.shape, (180, 320, 3), name)
        sunset = sky.paint_sky('sunset', 320, 180, horizon=0.4).astype(float)
        warm = lambda rows: (sunset[rows, :, 2] - sunset[rows, :, 0]).mean()  # Red over blue.
        self.assertGreater(warm(slice(60, 72)), warm(slice(0, 12)))  # Warmer near the horizon than at the top.
        night = sky.paint_sky('night', 320, 180).astype(float)
        self.assertLess(night.mean(), sky.paint_sky('blue', 320, 180).astype(float).mean() / 2)

    def test_the_camera_is_followed_by_the_far_land(self):
        rng = np.random.default_rng(1)
        world = (rng.random((140, 260, 3)) * 255).astype(np.uint8)
        near = np.full((90, 160), 0.3, np.float32); clear = np.zeros((90, 160), np.float32)
        follow = sky.Follow(2.0)
        follow.step(world[20:110, 40:200].copy(), clear, near)
        moved = follow.step(world[20:110, 46:206].copy(), clear, near)  # The camera panned right 6 px: the scene went left.
        self.assertAlmostEqual(moved[0], -12, delta=1.5)  # In full-size pixels (×2).

    def test_the_land_takes_the_new_skys_light(self):
        frame = np.full((90, 160, 3), 150, np.uint8)
        mask = np.zeros((90, 160), np.float32); near = np.full((90, 160), 0.5, np.float32)
        picture = sky.paint_sky('night', 192, 108)
        night = sky.compose(frame, picture, mask, near, (0, 0), sky.SKIES['night'])
        self.assertLess(night.mean(), 150 * 0.75)  # At least a quarter darker.
        self.assertGreater(night[..., 0].mean(), night[..., 2].mean())  # Bluer (BGR).
        with self.assertRaises(ValueError):
            sky.make(MediaFacts(path=Path('x.mp4'), media_type='video'), 0, 1, 'aurora')


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_sky_looks_like_the_cpu_sky(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip, depth = root / 'clip.mp4', root / 'depth.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=30', '-pix_fmt', 'yuv420p', str(clip)], check=True)
            # Sky (nearness 0) above row 140, land below.
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=1:r=30', '-vf', 'drawbox=x=0:y=140:w=640:h=220:color=0x707070:t=fill',
                            '-pix_fmt', 'yuv420p', str(depth)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
            for name in ('sunset', 'night'):
                made, used = {}, []
                with mock.patch.object(sky.settings, 'data_dir', root), mock.patch.object(sky, 'make_depth_map', return_value=depth):
                    for mode in ('1', '0'):
                        with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(sky, '_make', side_effect=lambda *a, real=sky._make, **k: used.append((k['gpu'], real(*a, **k))) or used[-1][1]):
                            out = sky.make(facts, 0, 1, name)
                        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                        made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                        out.unlink()
                self.assertEqual(used, [(True, True), (False, True)], name)  # Made on the GPU first, not quietly on the CPU.
                gpu, cpu = made['1'], made['0']
                self.assertEqual(gpu.shape, cpu.shape)
                psnr = 10 * np.log10(255 ** 2 / ((gpu - cpu) ** 2).mean())
                self.assertGreater(psnr, 32, (name, psnr))
                original = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(clip), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                first = np.frombuffer(original, np.uint8).reshape(360, 640, 3).astype(np.float64)
                self.assertGreater(np.abs(gpu[0][:100] - first[:100]).mean(), 30, name)  # The sky changed...
                self.assertLess(np.abs(gpu[0][200:] - first[200:]).mean(), np.abs(gpu[0][:100] - first[:100]).mean(), name)  # ...the land much less.


if __name__ == '__main__':
    unittest.main()
