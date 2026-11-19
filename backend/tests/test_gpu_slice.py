"""Slice into pieces: cropped, held pieces of a clip sliding away over the next. The crop as the GPU and the export draw it."""
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
from app.services.timeline_schema import Crop, Timeline
from app.services.timeline_service import render_timeline

W, H = 426, 240


def sliced(media=1, kind_rows=True, freeze=None) -> Timeline:
    """As frontend slice.ts makes it: 3 strips of clip a, held, sliding left, right, left over clip b."""
    pieces = []
    for i in range(3):
        crop = {'x0': 0, 'y0': i / 3, 'x1': 1, 'y1': (i + 1) / 3} if kind_rows else {'x0': i / 3, 'y0': 0, 'x1': (i + 1) / 3, 'y1': 1}
        sign = -1 if i % 2 == 0 else 1
        key = 'x' if kind_rows else 'y'
        piece = {'id': f'p{i}', 'media_id': media, 'start': 2, 'in': 1.2 if freeze else 0, 'out': 2.0 if freeze else 0.8, 'muted': True, 'crop': crop, 'freeze': freeze,
                 'transform': {'x': .5, 'y': .5, 'scale': 1, 'opacity': 1, 'rotation': 0,
                               'keyframes': {key: [{'t': 0, 'v': .5, 'ease': 'easeInOut'}, {'t': .8, 'v': .5 + sign * 1.15, 'ease': 'easeInOut'}]}}}
        pieces.append({'id': f'slice{i}', 'kind': 'video', 'name': f'Slice {i + 1}', 'items': [piece]})
    return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': 24}, 'layers': [
        {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': media, 'start': 0, 'in': 0, 'out': 2}, {'id': 'b', 'media_id': 2, 'start': 2, 'in': 0, 'out': 2}]}, *pieces]})


class Cropping(unittest.TestCase):
    def test_a_crop_keeps_some_of_the_picture(self):
        with self.assertRaises(ValueError):
            Crop(x0=.5, x1=.5)

    def test_a_sliced_clip_stays_on_the_gpu(self):
        facts = {1: MediaFacts(path=Path('a.png'), media_type='image', width=W, height=H), 2: MediaFacts(path=Path('b.png'), media_type='image', width=W, height=H),
                 3: MediaFacts(path=Path('v.mp4'), media_type='video', width=W, height=H, duration=4, fps=24)}
        self.assertEqual(gpu_render.unsupported(sliced(), facts.__getitem__), [])
        self.assertEqual(gpu_render.unsupported(sliced(3, freeze=1.9), facts.__getitem__), [])


@unittest.skipUnless(shutil.which('ffmpeg') and sys.platform == 'darwin' and shutil.which('swiftc'), 'needs ffmpeg and Metal')
class SliceOnTheGpu(unittest.TestCase):
    def test_the_gpu_draws_the_pieces_as_the_export(self):
        from app.services.cutout_service import helper
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            y, x = np.mgrid[:H, :W]
            pictures = (np.stack([x * 255 // W, y * 255 // H, 100 + 40 * np.sin(x / 25)], 2), np.stack([240 - y * 150 // H, 200 - x * 160 // W, 80 + y * 160 // H], 2))
            for i, picture in enumerate(pictures, 1):
                Image.fromarray(picture.astype(np.uint8)).save(root / f'{i}.png')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', str(root / '1.png'), '-vf', 'hue=h=t*40', '-t', '4', '-r', '24', '-pix_fmt', 'yuv420p', str(root / 'v.mp4')], check=True)
            facts = {1: MediaFacts(path=root / '1.png', media_type='image', width=W, height=H), 2: MediaFacts(path=root / '2.png', media_type='image', width=W, height=H),
                     3: MediaFacts(path=root / 'v.mp4', media_type='video', width=W, height=H, duration=4, fps=24)}
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir = root
                tool = helper(gpu_render.SOURCE)
            read = lambda path: np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']), np.uint8).reshape(-1, H, W, 3).astype(float)
            def worst(name, work):
                cpu, gpu = root / f'{name}-cpu.mp4', root / f'{name}-gpu.mp4'
                render_timeline(work, facts.__getitem__, lambda _: None, cpu, lambda _: None, hardware=False)
                gpu_render.render(work, facts.__getitem__, gpu, tool=tool)
                a, b = read(cpu), read(gpu)
                self.assertEqual(a.shape, b.shape)
                db = 10 * np.log10(255 ** 2 / np.maximum(((a - b) ** 2).mean(axis=(1, 2, 3)), 1e-10))
                return float(db.min()), a

            def without(work, what):
                data = work.model_dump(by_alias=True)
                for layer in data['layers'][1:]:
                    if what == 'crop':
                        layer['items'][0]['crop'] = None
                    else:
                        layer['items'][0]['transform']['keyframes'] = {}
                return Timeline.model_validate(data)

            for name, work in (('rows', sliced()), ('columns', sliced(kind_rows=False)), ('held video', sliced(3, freeze=1.9))):
                with self.subTest(name):
                    # The crop itself: the pieces held still, exactly where the export cuts them.
                    still, _ = worst(f'{name}-still', without(work, 'moves'))
                    # Sliding: no worse than the same moves without a crop (moving clips differ a little between the two
                    # engines already; a crop must not add to that).
                    sliding, frames = worst(name, work)
                    moving, _ = worst(f'{name}-uncropped', without(work, 'crop'))
                    print(f'slice {name} GPU dB: cropped still {still:.2f}, sliding {sliding:.2f}, same moves uncropped {moving:.2f}')
                    if name != 'held video':  # This test video differs on its own first frame, pieces or not.
                        self.assertGreaterEqual(still, 35, name)
                    self.assertGreaterEqual(sliding, moving - 1.5, name)
                    self.assertGreater(np.abs(frames[48 + 8] - frames[47]).mean(), 5, 'the strips have parted part way through')


if __name__ == '__main__':
    unittest.main()
