"""Adjustment layers on the GPU engine: a span grades everything below it, fading in and out, as the export does."""
import os
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
from app.services.timeline_schema import Timeline
from app.services.timeline_service import render_timeline

W, H = 426, 240


def timeline(**span) -> Timeline:
    return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': 24}, 'layers': [
        {'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 3}]},
        {'id': 'mood', 'kind': 'adjust', 'items': [{'id': 'm', 'start': 0.5, 'length': 2, 'fade_in': 0.5, 'fade_out': 0.5, **span}]},
        {'id': 'words', 'kind': 'text', 'items': [{'id': 't', 'start': 0, 'length': 3, 'text': 'நிலவே', 'color': '#ffffff', 'style': 'shadow', 'position': 'center', 'size': 50}]}]})


class AdjustSupport(unittest.TestCase):
    def test_a_grade_stays_on_the_gpu_and_a_glow_does_not(self):
        facts = {1: MediaFacts(path=Path('a.png'), media_type='image', width=W, height=H)}
        self.assertEqual(gpu_render.unsupported(timeline(look='warm'), facts.__getitem__), [])
        self.assertIn('glow on an adjustment layer', gpu_render.unsupported(timeline(dreamy_glow={'intensity': 0.5}), facts.__getitem__))


@unittest.skipUnless(shutil.which('ffmpeg') and sys.platform == 'darwin' and shutil.which('swiftc'), 'needs ffmpeg and Metal')
class AdjustOnTheGpu(unittest.TestCase):
    def test_the_gpu_grades_as_the_export_does(self):
        from app.services.cutout_service import helper
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            yy, xx = np.mgrid[:H, :W]
            Image.fromarray(np.stack([xx * 255 // W, yy * 255 // H, np.full_like(xx, 140)], 2).astype(np.uint8)).save(root / 'a.png')
            facts = {1: MediaFacts(path=root / 'a.png', media_type='image', width=W, height=H)}
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir = root
                tool = helper(gpu_render.SOURCE)
            read = lambda path: np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout, np.uint8).reshape(-1, H, W, 3).astype(float)
            for name, span in (('warm', {'look': 'warm'}), ('mono', {'look': 'mono', 'adjust': {'contrast': 1.2}}), ('wheels', {'look': 'vivid', 'wheels': {'shadows': {'hue': 220, 'amount': 0.3}, 'highlights': {'hue': 40, 'amount': 0.3, 'brightness': 0.1}}})):
                with self.subTest(name):
                    cpu, gpu = root / f'{name}-cpu.mp4', root / f'{name}-gpu.mp4'
                    with patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
                        render_timeline(timeline(**span), facts.__getitem__, lambda a: a, cpu, lambda _: None, hardware=False)
                    gpu_render.render(timeline(**span), facts.__getitem__, gpu, tool=tool)
                    a, b = read(cpu), read(gpu)
                    psnr = 10 * np.log10(255 ** 2 / np.maximum(((a - b) ** 2).mean(axis=(1, 2, 3)), 1e-10))
                    print(f'adjust {name} GPU dB: worst', round(float(psnr.min()), 2), 'average', round(float(psnr.mean()), 2))
                    self.assertGreaterEqual(psnr.min(), 35)
                    self.assertGreater(np.abs(a[36] - a[0]).mean(), 3, 'the grade shows mid-span')


if __name__ == '__main__':
    unittest.main()
