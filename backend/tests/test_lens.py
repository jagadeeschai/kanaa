"""Cinematic lens: what is at the focus distance stays exactly sharp, what is far from it blurs, the focus moves
smoothly for a rack focus, and the link to the original validates."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import lens_service as lens
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Clip


def sharpness(image: np.ndarray) -> float:
    gray = image.mean(axis=2)
    return float(np.abs(np.diff(gray, axis=1)).mean())


class Lens(unittest.TestCase):
    def test_in_focus_sharp_out_of_focus_soft(self):
        rng = np.random.default_rng(0)
        frame = rng.integers(0, 255, (360, 640, 3), dtype=np.uint8)  # Fine detail everywhere.
        near = np.zeros((360, 640), np.float32); near[:, :320] = 0.65; near[:, 320:] = 0.05  # Left at the focus, right far.
        out = lens.lens_frame(frame, near, 0.65, 1.0, False)
        self.assertTrue(np.array_equal(out[:, :280], frame[:, :280]))  # In focus: untouched.
        self.assertLess(sharpness(out[:, 380:]), sharpness(frame[:, 380:]) * 0.3)  # Far: much softer.

    def test_rack_focus_moves_smoothly(self):
        focus, amount, glow = lens.plan('rack-out', 'medium', 5.0)
        values = [lens.focus_at(focus, t / 10) for t in range(51)]
        self.assertAlmostEqual(values[0], 0.82); self.assertAlmostEqual(values[-1], 0.12)
        self.assertTrue(all(b <= a + 1e-9 for a, b in zip(values, values[1:])))
        self.assertEqual(lens.plan('dreamy', 'strong', 3)[1:], (lens.STRENGTH['strong'] * lens.PRESETS['dreamy'], True))

    def test_link_validates(self):
        clip = Clip.model_validate({'id': 'a', 'media_id': 9, 'start': 0, 'in': 0, 'out': 3, 'lens': {'original_media_id': 4, 'original_in': 2, 'original_out': 5, 'preset': 'rack-in'}})
        self.assertEqual(clip.lens.original_media_id, 4)


if __name__ == '__main__':
    unittest.main()


def frames(path: Path, width: int, height: int) -> np.ndarray:
    raw = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, height, width, 3).astype(np.float64)


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_lens_looks_like_the_cpu_lens(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip, depth = root / 'clip.mp4', root / 'depth.mp4'
            ffmpeg = shutil.which('ffmpeg')
            subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1:r=30', '-pix_fmt', 'yuv420p', str(clip)], check=True)
            # Left half at the focus (nearness 0.65), right half far: the right blurs, the left stays sharp.
            subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x0d0d0d:s=320x180:d=1:r=30', '-f', 'lavfi', '-i', 'color=c=0xa6a6a6:s=160x180:d=1:r=30',
                            '-filter_complex', '[0][1]overlay=0:0', '-pix_fmt', 'yuv420p', str(depth)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
            made, used = {}, []
            with mock.patch.object(lens.settings, 'data_dir', root), mock.patch.object(lens, 'make_depth_map', return_value=depth):
                for mode in ('1', '0'):
                    with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(lens, '_make_gpu', side_effect=lambda *a, real=lens._make_gpu: used.append(real(*a)) or used[-1]):
                        out = lens.make(facts, 0, 1, [(0.0, 0.65)], 1.5, False)
                        if mode == '1':
                            self.assertEqual(used, [True])  # Made on the GPU, not quietly on the CPU.
                        made[mode] = frames(out, 640, 360)
                        out.unlink()
            gpu, cpu = made['1'], made['0']
            self.assertEqual(gpu.shape, cpu.shape)
            psnr = 10 * np.log10(255 ** 2 / ((gpu - cpu) ** 2).mean())
            self.assertGreater(psnr, 30, psnr)
            original = frames(clip, 640, 360)
            self.assertLess(sharpness(gpu[5][:, 400:].astype(np.uint8)), sharpness(original[5][:, 400:].astype(np.uint8)) * 0.6)  # It did blur.
