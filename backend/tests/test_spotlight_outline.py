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
from app.services.cutout_service import helper
from app.services.graphic_outline import edge
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Format, Text, Timeline
from app.services.timeline_service import render_text_image, render_timeline

SQUARE = [[.3, .3], [.6, .3], [.6, .7], [.3, .7]]


def item(kind, style='clean', **extra):
    graphic = {'kind': kind, 'style': style, 'from': [.2, .25], 'to': [.5, .5], 'width': .3, 'height': .3, 'line_width': .012, **extra}
    if kind == 'outline' and 'shape' not in extra:
        graphic['shape'] = SQUARE
    return Text.model_validate({'id': kind, 'start': 0, 'length': 1, 'text': kind, 'style': 'plain', 'position': 'center', 'color': '#42f5e9', 'size': 36,
                                'enter': {'preset': 'reveal', 'duration': .5}, 'graphic': graphic})


class SpotlightAndOutline(unittest.TestCase):
    def test_spotlight_darkens_around_the_spot_not_on_it(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'spot.png'
            render_text_image(item('spotlight', dim=.7), Format(width=320, height=240, fps=24), target)
            alpha = np.asarray(Image.open(target).convert('RGBA'))[:, :, 3]
            self.assertLess(alpha[120, 160], 10)          # the spot stays clear
            self.assertGreater(alpha[10, 10], 150)        # a corner is dimmed by about dim
            self.assertLess(alpha[10, 10], 200)

    def test_spotlight_fades_in_with_progress(self):
        with tempfile.TemporaryDirectory() as folder:
            fmt = Format(width=320, height=240, fps=24); early, done = Path(folder) / 'a.png', Path(folder) / 'b.png'
            render_text_image(item('spotlight'), fmt, early, graphic_progress=.2)
            render_text_image(item('spotlight'), fmt, done)
            corner = lambda path: np.asarray(Image.open(path).convert('RGBA'))[5, 5, 3]
            self.assertLess(corner(early), corner(done))

    def test_outline_glows_along_its_shape_in_every_style(self):
        with tempfile.TemporaryDirectory() as folder:
            for style in ('clean', 'hand-drawn', 'neon', 'documentary'):
                target = Path(folder) / f'{style}.png'
                render_text_image(item('outline', style), Format(width=320, height=240, fps=24), target)
                alpha = np.asarray(Image.open(target).convert('RGBA'))[:, :, 3]
                self.assertGreater(alpha[72, 130], 100, style)   # on the top edge
                self.assertGreater(alpha[64, 130], 5, style)     # the glow reaches past it
                self.assertLess(alpha[120, 144], 5, style)       # the middle stays clear

    def test_outline_needs_a_shape(self):
        data = item('outline').model_dump(by_alias=True)
        data['graphic']['shape'] = None
        with self.assertRaises(ValueError):
            Text.model_validate(data)

    def test_edge_of_a_disc_is_round_and_short(self):
        yy, xx = np.mgrid[:200, :300]
        mask = (xx - 150) ** 2 + (yy - 100) ** 2 < 60 ** 2
        shape = edge(mask)
        self.assertLessEqual(len(shape), 160)
        self.assertGreater(len(shape), 8)
        for x, y in shape:
            self.assertAlmostEqual(np.hypot(x * 300 - 150, y * 200 - 100), 60, delta=3)
        with self.assertRaises(ValueError):
            edge(np.zeros((50, 50), bool))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
    def test_gpu_export_matches_ffmpeg(self):
        for kind, style in (('spotlight', 'documentary'), ('outline', 'clean')):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
                root = Path(folder); base = root / 'base.png'
                yy, xx = np.mgrid[:240, :320]
                Image.fromarray(np.stack([xx * 255 // 320, yy * 255 // 240, np.full_like(xx, 140)], 2).astype(np.uint8)).save(base)
                facts = {1: MediaFacts(path=base, media_type='image', width=320, height=240)}
                timeline = Timeline.model_validate({'format': {'width': 320, 'height': 240, 'fps': 24}, 'layers': [
                    {'id': 'main', 'kind': 'video', 'items': [{'id': 'base', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1}]},
                    {'id': 'graphics', 'kind': 'text', 'name': 'Graphics', 'items': [item(kind, style).model_dump(by_alias=True)]}]})
                self.assertEqual(gpu_render.unsupported(timeline, facts.__getitem__), [])
                target = root / 'cpu.mp4'
                render_timeline(timeline, facts.__getitem__, lambda _: None, target, lambda _: None, hardware=False)
                read = lambda path: np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout, np.uint8).reshape(-1, 240, 320, 3)
                frames = read(target)
                if kind == 'spotlight':
                    self.assertLess(frames[20, :20, :20].mean(), frames[0, :20, :20].mean() - 20)  # the corner darkened as it played
                if not (sys.platform == 'darwin' and shutil.which('swiftc')):
                    continue
                with patch('app.services.cutout_service.settings') as settings:
                    settings.data_dir = root
                    tool = helper(gpu_render.SOURCE)
                gpu = root / 'gpu.mp4'
                gpu_render.render(timeline, facts.__getitem__, gpu, tool=tool)
                mse = ((frames.astype(float) - read(gpu)) ** 2).mean(axis=(1, 2, 3))
                psnr = 10 * np.log10(255 ** 2 / np.maximum(mse, 1e-10))
                print(kind, 'GPU vs ffmpeg dB: worst', round(float(psnr.min()), 2), 'average', round(float(psnr.mean()), 2))
                self.assertGreaterEqual(float(psnr.min()), 35, psnr)


if __name__ == '__main__':
    unittest.main()
