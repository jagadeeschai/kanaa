"""Saturated addition followed by the overlay alpha, including transparent bright pixels."""
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
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Timeline
from app.services.timeline_service import render_timeline


def frames(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 240, 320, 3)


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
class AddBlend(unittest.TestCase):
    def test_transparent_and_opaque_bright_layers_match_the_math(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
            root = Path(folder)
            colours = {1: (160, 50, 30), 2: (160, 80, 100)}
            facts = {}
            for id, colour in colours.items():
                path = root / f'{id}.png'
                Image.new('RGB', (320, 240), colour).save(path)
                facts[id] = MediaFacts(path=path, media_type='image', width=320, height=240)
            tool = None
            if sys.platform == 'darwin' and shutil.which('swiftc'):
                with patch('app.services.cutout_service.settings') as settings:
                    settings.data_dir = root
                    tool = helper(gpu_render.SOURCE)
            for alpha in (0, .25, .5, 1):
                with self.subTest(alpha=alpha):
                    timeline = Timeline.model_validate({'format': {'width': 320, 'height': 240, 'fps': 24}, 'layers': [
                        {'id': 'main', 'kind': 'video', 'items': [{'id': 'base', 'media_id': 1, 'start': 0, 'in': 0, 'out': .5}]},
                        {'id': 'light', 'kind': 'video', 'blend': 'add', 'items': [{'id': 'top', 'media_id': 2, 'start': 0, 'in': 0, 'out': .5, 'transform': {'opacity': alpha}}]},
                    ]})
                    self.assertEqual(gpu_render.unsupported(timeline, facts.__getitem__), [])
                    output = root / f'ffmpeg-{alpha}.mp4'
                    render_timeline(timeline, facts.__getitem__, lambda _: None, output, lambda _: None, hardware=False)
                    a = frames(output)
                    expected = np.array(colours[1]) * (1-alpha) + np.minimum(255, np.array(colours[1])+colours[2]) * alpha
                    np.testing.assert_allclose(a[3, 120, 160], expected, atol=4)
                    if tool:
                        gpu = root / f'gpu-{alpha}.mp4'
                        gpu_render.render(timeline, facts.__getitem__, gpu, tool=tool)
                        b = frames(gpu)
                        self.assertEqual(a.shape, b.shape)
                        mse = ((a.astype(float)-b)**2).mean()
                        self.assertGreater(10*np.log10(255**2/max(mse, 1e-10)), 35, f'{alpha}: FFmpeg {a[3,120,160]}, GPU {b[3,120,160]}')
