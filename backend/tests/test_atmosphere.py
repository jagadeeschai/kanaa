"""Atmosphere from depth: far away fills with air, near stays clear, low fog keeps to the ground, the GPU copy looks
like the CPU one, and the link to the original validates."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import atmosphere_service as atmos
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Clip


class Air(unittest.TestCase):
    def test_far_fills_with_air_near_stays_clear(self):
        frame = np.zeros((180, 320, 3), np.uint8)
        near = np.zeros((180, 320), np.float32); near[:, :160] = 1.0  # Left near, right far.
        out = atmos.air_frame(frame, near, atmos.settings_for('mist', 'heavy'))
        self.assertLess(out[:, :120].mean(), 3)  # Near: untouched.
        self.assertGreater(out[:, 200:].mean(), 180)  # Far: mostly mist.

    def test_low_fog_lies_on_the_far_land_not_the_sky(self):
        frame = np.zeros((180, 320, 3), np.uint8)
        near = np.zeros((180, 320), np.float32); near[90:] = 0.25  # Sky above, far land below.
        out = atmos.air_frame(frame, near, atmos.settings_for('low-fog', 'medium'))
        self.assertLess(out[:60].mean(), 3)  # Sky: clear.
        self.assertGreater(out[120:].mean(), 120)  # Far land: fog.

    def test_sunset_never_paints_over_the_sky(self):
        frame = np.zeros((90, 160, 3), np.uint8)
        out = atmos.air_frame(frame, np.zeros((90, 160), np.float32), atmos.settings_for('sunset', 'heavy'))
        self.assertLess(out.mean(), 255 * 0.6)  # At most a little over half: the sun and sky show through.

    def test_stronger_is_thicker_and_choices_are_checked(self):
        frame = np.zeros((90, 160, 3), np.uint8); far = np.zeros((90, 160), np.float32)
        light, heavy = (atmos.air_frame(frame, far, atmos.settings_for('rain', each)).mean() for each in ('light', 'heavy'))
        self.assertLess(light, heavy)
        with self.assertRaises(ValueError):
            atmos.settings_for('smoke', 'medium')

    def test_link_validates(self):
        base = {'id': 'c', 'media_id': 9, 'start': 0, 'in': 0, 'out': 2}
        clip = Clip.model_validate({**base, 'atmosphere': {'original_media_id': 3, 'original_in': 1, 'original_out': 3, 'preset': 'sunset'}})
        self.assertEqual(clip.atmosphere.strength, 'medium')
        with self.assertRaises(ValueError):
            Clip.model_validate({**base, 'atmosphere': {'original_media_id': 3, 'original_in': 1, 'original_out': 3, 'preset': 'smoke'}})


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_air_looks_like_the_cpu_air(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip, depth = root / 'clip.mp4', root / 'depth.mp4'
            ffmpeg = shutil.which('ffmpeg')
            subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=30', '-pix_fmt', 'yuv420p', str(clip)], check=True)
            # Near at the left (bright), far at the right (dark).
            subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x0d0d0d:s=320x180:d=1:r=30', '-f', 'lavfi', '-i', 'color=c=0x404040:s=160x180:d=1:r=30',
                            '-filter_complex', '[0][1]overlay=0:0', '-pix_fmt', 'yuv420p', str(depth)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
            for preset in ('mist', 'low-fog'):
                made, used = {}, []
                with mock.patch.object(atmos.settings, 'data_dir', root), mock.patch.object(atmos, 'make_depth_map', return_value=depth):
                    for mode in ('1', '0'):
                        with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(atmos, '_make_gpu', side_effect=lambda *a, real=atmos._make_gpu: used.append(real(*a)) or used[-1]):
                            out = atmos.make(facts, 0, 1, preset, 'heavy')
                        raw = subprocess.run([ffmpeg, '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                        made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                        out.unlink()
                self.assertEqual(used, [True], preset)  # Made on the GPU, not quietly on the CPU.
                gpu, cpu = made['1'], made['0']
                psnr = 10 * np.log10(255 ** 2 / ((gpu - cpu) ** 2).mean())
                self.assertGreater(psnr, 32, (preset, psnr))
                if preset == 'mist':  # The far right fills with mist; low fog leaves it (sky-far) clear.
                    self.assertGreater(gpu[5][:, 400:].mean() - cpu[5][:, 400:].mean() + 1, 0)
                    self.assertGreater(gpu[5][:, 400:].mean(), 150)


if __name__ == '__main__':
    unittest.main()
