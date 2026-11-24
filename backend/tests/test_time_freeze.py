"""Time freeze in 3D: the camera paths start and end gently, near things swing past while far things barely move and
the people stay put, the gap behind the people is filled with what is beside it, and the GPU frames look like the CPU's."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import time_freeze_service as freeze
from app.services.media_probe import MediaFacts


def scene(width=320, height=180):
    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (height, width, 3), dtype=np.uint8)
    near = np.tile(np.linspace(0.05, 0.95, height, dtype=np.float32)[:, None], (1, width))  # Far at the top, near at the bottom.
    person = np.zeros((height, width), np.float32); person[60:150, 140:180] = 1
    return frame, near, person


class Moves(unittest.TestCase):
    def test_paths_start_and_end_gently_and_go_the_right_way(self):
        right, left, push = freeze.path('orbit-right', 30), freeze.path('orbit-left', 30), freeze.path('push-in', 30)
        self.assertAlmostEqual(right[0][0], -right[-1][0], places=6)
        self.assertGreater(right[-1][0], 0); self.assertLess(left[-1][0], 0)
        self.assertLess(abs(right[1][0] - right[0][0]), abs(right[15][0] - right[14][0]))  # Eases in.
        self.assertEqual(push[0][2], 0); self.assertAlmostEqual(push[-1][2], freeze.PUSH)
        with self.assertRaises(ValueError):
            freeze.make(MediaFacts(path=Path('x.mp4'), media_type='video'), 0, 2, 'spin')

    def test_near_swings_far_barely_moves_people_stay(self):
        frame, near, person = scene()
        plate = freeze.fill_behind(frame, person)
        still = freeze.view(plate, frame, person, near, 0.5, (0.0, 0.0, 0.0))
        moved = freeze.view(plate, frame, person, near, 0.5, (0.05, 0.0, 0.0))
        diff = np.abs(moved.astype(int) - still.astype(int)).mean(axis=2)
        self.assertGreater(diff[170:].mean(), diff[90:100, :120].mean())  # Near (bottom) changes more than the middle.
        self.assertLess(np.abs(moved[80:140, 150:170].astype(int) - still[80:140, 150:170].astype(int)).mean(), 1)  # The person holds.

    def test_the_gap_behind_the_people_carries_on_what_is_beside_it(self):
        frame = np.zeros((90, 160, 3), np.uint8); frame[:, :80] = (0, 200, 0); frame[:, 80:] = (0, 0, 200)
        person = np.zeros((90, 160), np.float32); person[20:70, 60:100] = 1
        frame[20:70, 60:100] = 255  # The person, white.
        plate = freeze.fill_behind(frame, person)
        self.assertLess(plate[45, 62:78].astype(int)[:, 1].min(), 256); self.assertGreater(plate[45, 62:70, 1].mean(), 150)  # Green continues on the left.
        self.assertGreater(plate[45, 90:98, 2].mean(), 150)  # Red continues on the right.
        self.assertLess(plate[20:70, 60:100].mean(axis=2).max(), 200)  # No white person left.


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_freeze_looks_like_the_cpu_freeze(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip, depth = root / 'clip.mp4', root / 'depth.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=2:r=30', '-pix_fmt', 'yuv420p', str(clip)], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'gradients=s=640x360:d=2:r=30:c0=0x101010:c1=0xf0f0f0:x0=0:y0=0:x1=0:y1=360', '-vf', 'format=gray', '-pix_fmt', 'yuv420p', str(depth)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=2, fps=30)
            person = np.zeros((360, 640), np.float32); person[120:300, 280:360] = 1
            for move in ('orbit-right', 'push-in'):
                made, used = {}, []
                with mock.patch.object(freeze.settings, 'data_dir', root), mock.patch.object(freeze, 'make_depth_map', return_value=depth), \
                        mock.patch.object(freeze, 'find_people', return_value=person):
                    for mode in ('1', '0'):
                        with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(freeze, '_make_gpu', side_effect=lambda *a, real=freeze._make_gpu: used.append(real(*a)) or used[-1]):
                            out = freeze.make(facts, 1.0, 1.0, move)
                        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                        made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                        out.unlink()
                self.assertEqual(used, [True], move)
                gpu, cpu = made['1'], made['0']
                self.assertEqual(gpu.shape, cpu.shape)
                for k in (0, len(gpu) // 2, len(gpu) - 1):
                    psnr = 10 * np.log10(255 ** 2 / ((gpu[k] - cpu[k]) ** 2).mean())
                    # 28 dB on this razor-sharp test pattern (the two engines sample its hard edges a little
                    # differently); 49 dB on real footage (the skyline clip, measured).
                    self.assertGreater(psnr, 28, (move, k, psnr))
                self.assertGreater(np.abs(gpu[-1] - gpu[0]).mean(), 2, move)  # The camera did move.


if __name__ == '__main__':
    unittest.main()
