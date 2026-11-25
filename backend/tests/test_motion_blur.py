"""Real motion blur: still pictures stay sharp; a moving shape smears along its movement, not across it; a longer
shutter smears more; a whip pan is capped so it stays readable; and the GPU frames look like the CPU's."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import blur_service as blur
from app.services.media_probe import MediaFacts


def square(x: int) -> np.ndarray:
    frame = np.full((120, 240, 3), 30, np.uint8)
    frame[40:80, x:x + 40] = 220
    frame[40:80:5, x:x + 40] = 120  # Texture, so the motion can be measured.
    return frame


class Smear(unittest.TestCase):
    def test_still_stays_sharp_moving_smears_along_its_movement(self):
        frame = square(100)
        motion = np.zeros((30, 60, 2), np.float32)
        self.assertEqual(np.abs(blur.smear(frame, motion, 0.5).astype(int) - frame.astype(int)).max(), 0)  # Still: untouched.
        motion[..., 0] = 24  # Moving right 24 pixels a frame.
        smeared = blur.smear(frame, motion, 0.5).astype(float)
        across = np.abs(np.diff(smeared[60, :, 1])).max()  # The edge along the movement softens...
        down = np.abs(np.diff(smeared[:, 120, 1])).max()  # ...the edge across it stays sharp.
        self.assertLess(across, 120)
        self.assertGreater(down, 150)
        longer = blur.smear(frame, motion, 1.0).astype(float)
        self.assertLess(np.abs(np.diff(longer[60, :, 1])).max(), across)  # A longer shutter smears more.

    def test_motion_is_measured_both_ways_and_a_whip_pan_is_capped(self):
        motion = blur.Motion(240, 120, (60, 30))
        greys = [motion.grey(square(x)) for x in (90, 100, 110)]
        moved = motion.around(greys[0], greys[1], greys[2])
        self.assertGreater(float(np.median(moved[10:20, 25:35, 0])), 5)  # Moving right, about 10 pixels a frame.
        fast = blur.Motion(240, 120, (60, 30))
        whip = fast.around(None, fast.grey(square(10)), fast.grey(square(200)))
        self.assertLessEqual(float(np.linalg.norm(whip, axis=2).max()), blur.LONGEST * 240 + 0.5)
        with self.assertRaises(ValueError):
            blur.make(MediaFacts(path=Path('x.mp4'), media_type='video'), 0, 1, 'warp')


@unittest.skipUnless(shutil.which('swiftc') and shutil.which('ffmpeg'), 'needs Swift and ffmpeg')
class GpuParity(unittest.TestCase):
    def test_the_gpu_blur_looks_like_the_cpu_blur(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip = root / 'clip.mp4'
            # A still, textured picture (like real footage; flat colour has nothing to follow) panned across: the only
            # motion is the pan, sideways.
            import cv2
            still = root / 'still.png'
            texture = cv2.GaussianBlur(np.random.default_rng(2).integers(0, 255, (720, 1280, 3), dtype=np.uint8), (0, 0), 1.5)
            cv2.imwrite(str(still), cv2.normalize(texture, None, 0, 255, cv2.NORM_MINMAX))
            subprocess.run(['ffmpeg', '-v', 'error', '-loop', '1', '-i', str(still), '-t', '1', '-r', '30', '-vf', "crop=640:360:'t*300':100", '-pix_fmt', 'yuv420p', str(clip)], check=True)
            facts = MediaFacts(path=clip, media_type='video', width=640, height=360, duration=1, fps=30)
            made, used = {}, []
            with mock.patch.object(blur.settings, 'data_dir', root):
                for mode in ('1', '0'):
                    with mock.patch.dict(os.environ, {'KANAA_GPU_EFFECTS': mode}), mock.patch.object(blur, '_make', side_effect=lambda *a, real=blur._make, **k: used.append((k['gpu'], real(*a, **k))) or used[-1][1]):
                        out = blur.make(facts, 0, 1, 'natural')
                    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
                    made[mode] = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
                    out.unlink()
            self.assertEqual(used, [(True, True), (False, True)])
            gpu, cpu = made['1'], made['0']
            psnr = 10 * np.log10(255 ** 2 / ((gpu - cpu) ** 2).mean())
            self.assertGreater(psnr, 32, psnr)
            original = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(clip), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
            sharp = np.frombuffer(original, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
            # The pan is sideways: detail across it softens compared with detail down it (encoder noise affects both).
            ratio = lambda picture: np.abs(np.diff(picture, axis=1)).mean() / np.abs(np.diff(picture, axis=0)).mean()
            self.assertLess(ratio(gpu[15]), ratio(sharp[15]) * 0.9)


if __name__ == '__main__':
    unittest.main()
