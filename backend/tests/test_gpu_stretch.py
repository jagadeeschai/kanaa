"""Stretch: a picture made wider or narrower before it is fitted (Fit / Fill / Stretch, and free corner resizing). The GPU
engine and the FFmpeg export draw it alike, and a stretched upright picture fills a wide frame with nothing cut off."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from app.services import gpu_render
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Clip, Timeline
from app.services.timeline_service import render_timeline

W, H = 426, 240
PW, PH = 120, 214  # An upright picture.


def work() -> Timeline:
    to_frame = (W / H) / (PW / PH)  # As stretchToFrame in resize.ts.
    return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': 24}, 'layers': [
        {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1, 'stretch': to_frame}]},
        {'id': 'over', 'kind': 'video', 'items': [{'id': 'b', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1, 'stretch': 0.6,
                                                   'transform': {'x': .7, 'y': .4, 'scale': .5, 'opacity': 1, 'rotation': 0}}]}]})


class StretchSchema(unittest.TestCase):
    def test_kept_in_range_and_on_the_gpu(self):
        with self.assertRaises(ValueError):
            Clip.model_validate({'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1, 'stretch': 0})
        facts = {1: MediaFacts(path=Path('p.png'), media_type='image', width=PW, height=PH)}
        self.assertEqual(gpu_render.unsupported(work(), facts.__getitem__), [])


@unittest.skipUnless(shutil.which('ffmpeg') and sys.platform == 'darwin' and shutil.which('swiftc'), 'needs ffmpeg and Metal')
class StretchOnTheGpu(unittest.TestCase):
    def test_the_gpu_stretches_as_the_export(self):
        from app.services.cutout_service import helper
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            y, x = np.mgrid[:PH, :PW]
            Image.fromarray(np.stack([x * 255 // PW, y * 255 // PH, 120 + 60 * np.sin(x / 30) * np.cos(y / 35)], 2).astype(np.uint8)).save(root / 'p.png')
            facts = {1: MediaFacts(path=root / 'p.png', media_type='image', width=PW, height=PH)}
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir = root
                tool = helper(gpu_render.SOURCE)
            read = lambda path: np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']), np.uint8).reshape(-1, H, W, 3).astype(float)
            cpu, gpu = root / 'cpu.mp4', root / 'gpu.mp4'
            render_timeline(work(), facts.__getitem__, lambda _: None, cpu, lambda _: None, hardware=False)
            gpu_render.render(work(), facts.__getitem__, gpu, tool=tool)
            a, b = read(cpu), read(gpu)
            db = 10 * np.log10(255 ** 2 / np.maximum(((a - b) ** 2).mean(axis=(1, 2, 3)), 1e-10))
            # The same layout unstretched: the two engines' own difference when a small picture is enlarged.
            plain = work().model_dump(by_alias=True)
            for layer in plain['layers']:
                for item in layer['items']:
                    item['stretch'] = 1
            c2, g2 = root / 'cpu-plain.mp4', root / 'gpu-plain.mp4'
            render_timeline(Timeline.model_validate(plain), facts.__getitem__, lambda _: None, c2, lambda _: None, hardware=False)
            gpu_render.render(Timeline.model_validate(plain), facts.__getitem__, g2, tool=tool)
            p, q = read(c2), read(g2)
            base = 10 * np.log10(255 ** 2 / np.maximum(((p - q) ** 2).mean(axis=(1, 2, 3)), 1e-10))
            print(f'stretch GPU dB: worst {db.min():.2f}, same layout unstretched {base.min():.2f}')
            self.assertGreaterEqual(db.min(), min(35, base.min() - 1.5))
            # Stretched to the frame: no black bars at the sides (an upright picture fitted would leave them).
            self.assertGreater(a[5][:, :8].mean(), 20)
            self.assertGreater(a[5][:, -8:].mean(), 20)


if __name__ == '__main__':
    unittest.main()
