"""Split screen reveal: the new clip opens beside the old, both side by side, then it fills; the GPU as the export."""
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
from app.services.split_screen import amount, parts
from app.services.timeline_schema import Timeline
from app.services.timeline_service import render_timeline

W, H = 426, 240


def timeline(direction=None) -> Timeline:
    return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': 24}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [
        {'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2},
        {'id': 'b', 'media_id': 2, 'start': 2, 'in': 0, 'out': 2, 'transition_in': {'kind': 'split-screen', 'duration': 1.2, 'direction': direction}}]}]})


class SplitScreenMath(unittest.TestCase):
    def test_opens_holds_side_by_side_then_fills(self):
        self.assertEqual((amount(0), amount(0.5), amount(1)), (0, 0.5, 1))
        for direction in (None, 'left', 'right', 'up', 'down'):
            with self.subTest(direction):
                start, middle, end = parts(0, direction, W, H), parts(0.5, direction, W, H), parts(1, direction, W, H)
                vertical = direction in ('up', 'down')
                size = 3 if vertical else 2
                self.assertEqual(start['b'][size], 0, 'the new clip starts hidden')
                self.assertEqual(end['a'][size], 0, 'and ends filling the frame')
                self.assertEqual(middle['a'][size] + middle['b'][size], H if vertical else W, 'side by side, the frame shared')
                for state in (start, middle, end):
                    self.assertTrue(all(value % 2 == 0 for value in state['a'] + state['b']), 'on the two-pixel grid')

    def test_it_stays_on_the_gpu(self):
        facts = {i: MediaFacts(path=Path(f'{i}.png'), media_type='image', width=W, height=H) for i in (1, 2)}
        self.assertEqual(gpu_render.unsupported(timeline(), facts.__getitem__), [])


@unittest.skipUnless(shutil.which('ffmpeg') and sys.platform == 'darwin' and shutil.which('swiftc'), 'needs ffmpeg and Metal')
class SplitScreenOnTheGpu(unittest.TestCase):
    def test_the_gpu_draws_it_as_the_export(self):
        from app.services.cutout_service import helper
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            y, x = np.mgrid[:H, :W]
            pictures = (np.stack([x * 255 // W, y * 255 // H, 100 + 40 * np.sin(x / 25)], 2), np.stack([240 - y * 150 // H, 200 - x * 160 // W, 80 + y * 160 // H], 2))
            for i, picture in enumerate(pictures, 1):
                Image.fromarray(picture.astype(np.uint8)).save(root / f'{i}.png')
            facts = {i: MediaFacts(path=root / f'{i}.png', media_type='image', width=W, height=H) for i in (1, 2)}
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir = root
                tool = helper(gpu_render.SOURCE)
            read = lambda path: np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']), np.uint8).reshape(-1, H, W, 3).astype(float)
            for direction in (None, 'right', 'up', 'down'):
                with self.subTest(direction):
                    work, name = timeline(direction), direction or 'left'
                    cpu, gpu = root / f'{name}-cpu.mp4', root / f'{name}-gpu.mp4'
                    render_timeline(work, facts.__getitem__, lambda _: None, cpu, lambda _: None, hardware=False)
                    gpu_render.render(work, facts.__getitem__, gpu, tool=tool)
                    a, b = read(cpu), read(gpu)
                    self.assertEqual(a.shape, b.shape)
                    db = 10 * np.log10(255 ** 2 / np.maximum(((a - b) ** 2).mean(axis=(1, 2, 3)), 1e-10))
                    print(f'split screen {name} GPU dB: worst {db.min():.2f} average {db.mean():.2f} (frame {int(db.argmin())})')
                    self.assertGreaterEqual(float(db.min()), 35, name)
                    # Half way: both pictures side by side, the old one on the side it leaves from.
                    half = a[len(a) // 2]
                    self.assertGreater(np.abs(half - a[0]).mean(), 5, 'the frame changed by half way')


if __name__ == '__main__':
    unittest.main()
