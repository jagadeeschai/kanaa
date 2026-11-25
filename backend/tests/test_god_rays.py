"""God rays: the light is found at the coloured sun, not the white haze; only the sky gives light; the beams are
brightest near the source and a solid shape in the way leaves a shadow behind it; the GPU frames look like the CPU's."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import rays_service as rays
from app.services.media_probe import MediaFacts


def scene():
    frame = np.full((180, 320, 3), 235, np.uint8)  # A white, overexposed haze...
    frame[40:46, 220:226] = (60, 150, 250)  # ...and a small orange sun (BGR).
    frame[90:] = (40, 110, 40)  # Land below.
    near = np.zeros((180, 320), np.float32); near[90:] = 0.4
    return frame, near


class Rays(unittest.TestCase):
    def test_the_light_is_the_coloured_sun_and_only_the_sky_gives_light(self):
        frame, near = scene()
        at = rays.find_light(frame, near)
        self.assertAlmostEqual(at[0], 223 / 320, delta=0.02); self.assertAlmostEqual(at[1], 43 / 180, delta=0.02)
        mask = rays.light_mask(frame, near, at)
        self.assertEqual(float(mask[100:].max()), 0.0)  # Land never gives light.
        self.assertGreater(mask[38:48, 216:230].mean(), mask[10:20, 20:40].mean())  # Most at the source.
        self.assertIsNone(rays.find_light(frame, np.ones((180, 320), np.float32)))  # No sky: no light.

    def test_beams_fade_from_the_source_and_a_shape_in_the_way_leaves_a_shadow(self):
        mask = np.zeros((90, 160), np.float32); mask[20:30, 70:90] = 1  # A light high in the middle.
        open_sky = rays.beams(mask, (0.5, 0.28), rays.PRESETS['strong'])
        self.assertGreater(open_sky[40, 80], open_sky[85, 80])  # Brighter nearer the source.
        blocked = mask.copy(); blocked[20:30, 76:84] = 0  # Something stands in front of part of it.
        shade = rays.beams(blocked, (0.5, 0.28), rays.PRESETS['strong'])
        self.assertLess(shade[38, 80], open_sky[38, 80] - 0.05)  # A shadow streak just below it.
        lit = rays.compose(np.full((90, 160, 3), 100, np.uint8), open_sky, rays.PRESETS['dusty'])
        self.assertGreater(lit[40, 80, 2], lit[40, 80, 0])  # Dusty light is warm (more red than blue, BGR).
        with self.assertRaises(ValueError):
            rays.make(MediaFacts(path=Path('x.mp4'), media_type='video'), 0, 1, 'laser')


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_rays_look_like_the_cpu_rays(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip, depth = root / 'clip.mp4', root / 'depth.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xe8e8e8:s=640x360:d=1:r=30', '-vf',
                            'drawbox=x=420:y=80:w=14:h=14:color=0xffa040:t=fill,drawbox=x=0:y=200:w=640:h=160:color=0x306030:t=fill,drawbox=x=300:y=120:w=30:h=90:color=0x203020:t=fill',
                            '-pix_fmt', 'yuv420p', str(clip)], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=1:r=30', '-vf',
                            'drawbox=x=0:y=200:w=640:h=160:color=0x707070:t=fill,drawbox=x=300:y=120:w=30:h=90:color=0x707070:t=fill', '-pix_fmt', 'yuv420p', str(depth)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
            made, used = {}, []
            with mock.patch.object(rays.settings, 'data_dir', root), mock.patch.object(rays, 'make_depth_map', return_value=depth):
                for mode in ('1', '0'):
                    with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(rays, '_make', side_effect=lambda *a, real=rays._make, **k: used.append((k['gpu'], real(*a, **k))) or used[-1][1]):
                        out = rays.make(facts, 0, 1, 'strong')
                    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                    made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                    out.unlink()
            self.assertEqual(used, [(True, True), (False, True)])
            gpu, cpu = made['1'], made['0']
            psnr = 10 * np.log10(255 ** 2 / ((gpu - cpu) ** 2).mean())
            self.assertGreater(psnr, 32, psnr)
            original = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(clip), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
            self.assertGreater(gpu[0][220:300].mean() - np.frombuffer(original, np.uint8).reshape(360, 640, 3)[220:300].mean(), 3)  # The land is lit.


if __name__ == '__main__':
    unittest.main()
