import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from app.services import gpu_render
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Format, Text, Timeline
from app.services.timeline_service import render_text_image, render_timeline


KINDS = ('arrow-straight', 'arrow-curved', 'circle', 'box', 'callout')


def item(kind, style='clean'):
    return Text.model_validate({'id': kind, 'start': 0, 'length': 1, 'text': 'தமிழ் label', 'style': 'plain', 'position': 'center', 'color': '#f5c11b', 'size': 36,
        'enter': {'preset': 'reveal', 'duration': .5}, 'graphic': {'kind': kind, 'style': style, 'from': [.2, .25], 'to': [.7, .65], 'width': .3, 'height': .22, 'line_width': .012}})


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
class ExplainerGraphics(unittest.TestCase):
    def test_all_graphics_and_styles_render_transparent_images(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); fmt = Format(width=320, height=240, fps=24)
            for kind in KINDS:
                for style in ('clean', 'hand-drawn', 'neon', 'documentary'):
                    with self.subTest(kind=kind, style=style):
                        target = root / f'{kind}-{style}.png'
                        render_text_image(item(kind, style), fmt, target)
                        rgba = np.asarray(Image.open(target).convert('RGBA'))
                        self.assertGreater(np.count_nonzero(rgba[:, :, 3]), 40)
                        self.assertEqual(rgba.shape, (240, 320, 4))

    def test_schema_rejects_points_outside_the_frame(self):
        data = item('circle').model_dump(by_alias=True)
        data['graphic']['to'] = [1.2, .5]
        with self.assertRaises(ValueError):
            Text.model_validate(data)

    def test_reference_export_animates_graphic_and_gpu_falls_back(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
            root = Path(folder); base = root / 'base.png'; Image.new('RGB', (320, 240), (24, 30, 40)).save(base)
            facts = {1: MediaFacts(path=base, media_type='image', width=320, height=240)}
            timeline = Timeline.model_validate({'format': {'width': 320, 'height': 240, 'fps': 24}, 'layers': [
                {'id': 'main', 'kind': 'video', 'items': [{'id': 'base', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1}]},
                {'id': 'graphics', 'kind': 'text', 'name': 'Graphics', 'items': [item('arrow-curved', 'documentary').model_dump(by_alias=True)]},
            ]})
            self.assertIn('explainer graphics', gpu_render.unsupported(timeline, facts.__getitem__))
            target = root / 'graphic.mp4'
            render_timeline(timeline, facts.__getitem__, lambda _: None, target, lambda _: None, hardware=False)
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
            frames = np.frombuffer(raw, np.uint8).reshape(-1, 240, 320, 3)
            base_colour = np.array([24, 30, 40])
            early = np.linalg.norm(frames[1].astype(int) - base_colour, axis=2) > 30
            settled = np.linalg.norm(frames[18].astype(int) - base_colour, axis=2) > 30
            self.assertGreater(settled.sum(), early.sum())
            self.assertGreater(settled.sum(), 100)


if __name__ == '__main__':
    unittest.main()
