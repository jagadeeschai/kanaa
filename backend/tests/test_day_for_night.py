"""Day for night: the sky goes deep night-blue, near things stay brighter than far, colour drains towards moonlight,
deep night is darker than moonlit, never pure black, and the GPU frames look like the CPU's."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import night_service as night
from app.services.media_probe import MediaFacts


class Night(unittest.TestCase):
    def test_sky_goes_blue_near_stays_brighter_than_far(self):
        frame = np.full((180, 320, 3), 200, np.uint8)
        near = np.zeros((180, 320), np.float32); near[60:120] = 0.15; near[120:] = 0.9  # Sky, far land, near land.
        out = night.night_frame(frame, near, night.settings_for('moonlit')).astype(float)
        sky, far, close = out[10:40].mean(axis=(0, 1)), out[75:105].mean(axis=(0, 1)), out[140:].mean(axis=(0, 1))
        self.assertGreater(sky[0], sky[2] * 1.8)  # Blue (BGR) well over red in the sky.
        self.assertLess(sky.mean(), 90)  # The bright day sky is dark now.
        self.assertGreater(close.mean(), far.mean() * 1.2)  # The near stays readable.

    def test_colour_drains_deep_night_is_darker_never_black(self):
        green = np.zeros((90, 160, 3), np.uint8); green[..., 1] = 220
        near = np.full((90, 160), 0.8, np.float32)
        moon, dark = (night.night_frame(green, near, night.settings_for(mood)).astype(float) for mood in ('moonlit', 'dark'))
        self.assertLess(moon[..., 1].mean() / max(moon[..., 0].mean(), 1), 220 / 1)  # Less pure green.
        self.assertLess(dark.mean(), moon.mean())
        black = night.night_frame(np.zeros((90, 160, 3), np.uint8), near, night.settings_for('dark'))
        self.assertGreater(black[..., 0].mean(), 5)  # A deep blue floor, not black.
        with self.assertRaises(ValueError):
            night.settings_for('dusk')


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_night_looks_like_the_cpu_night(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip, depth = root / 'clip.mp4', root / 'depth.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=30', '-pix_fmt', 'yuv420p', str(clip)], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'gradients=s=640x360:d=1:r=30:c0=0x000000:c1=0xf0f0f0:x0=0:y0=0:x1=0:y1=360', '-vf', 'format=gray', '-pix_fmt', 'yuv420p', str(depth)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
            made, used = {}, []
            with mock.patch.object(night.settings, 'data_dir', root), mock.patch.object(night, 'make_depth_map', return_value=depth):
                for mode in ('1', '0'):
                    with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(night, '_make_gpu', side_effect=lambda *a, real=night._make_gpu: used.append(real(*a)) or used[-1]):
                        out = night.make(facts, 0, 1, 'moonlit')
                    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                    made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                    out.unlink()
            self.assertEqual(used, [True])
            gpu, cpu = made['1'], made['0']
            psnr = 10 * np.log10(255 ** 2 / ((gpu - cpu) ** 2).mean())
            self.assertGreater(psnr, 32, psnr)


if __name__ == '__main__':
    unittest.main()
