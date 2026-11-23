"""Smooth slow motion: the frames made between two follow the motion (a moving square lands between where it was and
where it went, not as two faded copies), and a clip part comes out the right length."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import slowmo_service as slow
from app.services.media_probe import MediaFacts


def square(x: int) -> np.ndarray:
    frame = np.full((180, 320, 3), 40, np.uint8)
    frame[60:120, x:x + 60] = (40, 200, 240)
    # Texture so the motion can be measured.
    frame[60:120:6, x:x + 60] = (10, 60, 90)
    return frame


class Between(unittest.TestCase):
    def test_made_frame_sits_halfway_along_the_motion(self):
        middle = slow.Between().frames(square(60), square(100), 1)[0]
        bright = np.nonzero((middle[..., 2] > 150).any(axis=0))[0]
        self.assertAlmostEqual((bright.min() + bright.max()) / 2, 80 + 30, delta=4)  # The square's middle, halfway.
        self.assertGreater(middle[93, 110, 2], 150)  # Solid where it should be, not a faded double.


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Clip(unittest.TestCase):
    def test_a_part_comes_out_factor_times_longer(self):
        root = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, root)
        clip = root / 'clip.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-pix_fmt', 'yuv420p', str(clip)], check=True)
        facts = MediaFacts(path=clip, media_type='video', width=320, height=180, duration=2, fps=30)
        with mock.patch.object(slow.settings, 'data_dir', root):
            made = slow.make(facts, 0.5, 1.0, 4)
        frames = int(subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(made)],
                                    capture_output=True, text=True).stdout.strip())
        self.assertEqual(frames, 15 * 4)
        with self.assertRaises(ValueError):
            slow.make(facts, 0, 1, 3)


    @unittest.skipUnless(shutil.which('swiftc'), 'needs Swift')
    def test_the_gpu_frames_look_like_the_cpu_frames(self):
        root = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, root)
        clip = root / 'clip.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=1', '-pix_fmt', 'yuv420p', str(clip)], check=True)
        facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
        made, used = {}, []
        with mock.patch.object(slow.settings, 'data_dir', root):
            for mode in ('1', '0'):
                with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(slow, '_make_gpu', side_effect=lambda *a, real=slow._make_gpu: used.append(real(*a)) or used[-1]):
                    out = slow.make(facts, 0.2, 0.6, 4)
                raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                out.unlink()
        self.assertEqual(used, [True])  # Made on the GPU, not quietly on the CPU.
        gpu, cpu = made['1'], made['0']
        self.assertEqual(gpu.shape, cpu.shape)
        for k in (1, 2, 3, 5):  # Made frames, and one of the clip's own.
            psnr = 10 * np.log10(255 ** 2 / ((gpu[k] - cpu[k]) ** 2).mean())
            self.assertGreater(psnr, 30, (k, psnr))


if __name__ == '__main__':
    unittest.main()
