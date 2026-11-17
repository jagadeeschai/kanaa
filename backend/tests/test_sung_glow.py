"""The sung word glows with the music: karaoke pictures carry a glow strength, the same in the export and on the GPU."""
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

from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Format, Text, Timeline
from app.services.timeline_service import GLOW_LEVELS, glow_picture, karaoke_states, render_text_image, render_timeline

LINE = {'id': 't', 'start': 0, 'length': 3, 'text': 'நிலவே நீ வா', 'style': 'shadow', 'position': 'center', 'size': 60, 'color': '#ffffff'}
LEVELS = [0, 0, 0, 1, 1, 2, 2, 2, 1, 0] * 3


def line(**karaoke) -> Text:
    return Text.model_validate({**LINE, 'karaoke': {'color': '#ffd54a', 'words': [0.2, 1, 2], **karaoke}})


class GlowStates(unittest.TestCase):
    def test_states_follow_the_words_and_the_loudness(self):
        self.assertEqual(karaoke_states(line()), [(0.0, 0.2, None), (0.2, 1.0, 0), (1.0, 2.0, 1), (2.0, 3.0, 2)], 'unchanged without a glow')
        states = karaoke_states(line(glow=True, levels=LEVELS))
        self.assertEqual(states[:4], [(0.0, 0.2, None), (0.2, 0.3, 0), (0.3, 0.5, 1), (0.5, 0.8, 2)])
        self.assertEqual([glow_picture(line(glow=True), picture) for _, _, picture in states[1:4]], [(0, 0), (0, 1), (0, 2)])
        self.assertEqual(states[-1][1], 3.0)
        self.assertTrue(all(b[0] == a[1] for a, b in zip(states, states[1:])), 'no gaps')
        self.assertEqual({picture // GLOW_LEVELS for _, _, picture in states[1:]}, {0, 1, 2})

    def test_a_louder_moment_glows_more(self):
        format_ = Format(width=640, height=360, fps=30)
        with tempfile.TemporaryDirectory() as folder:
            def glow(picture):
                target = Path(folder) / f'{picture}.png'
                render_text_image(line(glow=True), format_, target, lit=picture)
                rgba = np.asarray(Image.open(target).convert('RGBA')).astype(float)
                return ((rgba[..., 3] > 8) & (rgba[..., 3] < 200)).sum()  # Soft halo pixels.
            quiet, loud = glow(1 * GLOW_LEVELS + 0), glow(1 * GLOW_LEVELS + 2)
            render_text_image(line(), format_, Path(folder) / 'plain.png', lit=1)
        self.assertGreater(loud, quiet * 1.3)


@unittest.skipUnless(shutil.which('ffmpeg') and sys.platform == 'darwin' and shutil.which('swiftc'), 'needs ffmpeg and Metal')
class GlowOnTheGpu(unittest.TestCase):
    def test_the_gpu_draws_the_same_glow(self):
        from app.services import gpu_render
        from app.services.cutout_service import helper
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            Image.new('RGB', (640, 360), (26, 34, 53)).save(root / 'bg.png')
            facts = {1: MediaFacts(path=root / 'bg.png', media_type='image', width=640, height=360)}
            text = line(glow=True, levels=LEVELS).model_dump(by_alias=True)
            timeline = Timeline.model_validate({'format': {'width': 640, 'height': 360, 'fps': 30}, 'layers': [
                {'id': 'm', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 3}]}, {'id': 'w', 'kind': 'text', 'items': [text]}]})
            self.assertEqual(gpu_render.unsupported(timeline, facts.__getitem__), [])
            cpu = root / 'cpu.mp4'
            with patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
                render_timeline(timeline, facts.__getitem__, lambda a: a, cpu, lambda _: None, hardware=False)
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir = root
                tool = helper(gpu_render.SOURCE)
            gpu = root / 'gpu.mp4'
            gpu_render.render(timeline, facts.__getitem__, gpu, tool=tool)
            read = lambda path: np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout, np.uint8).reshape(-1, 360, 640, 3).astype(float)
            a, b = read(cpu), read(gpu)
            psnr = 10 * np.log10(255 ** 2 / np.maximum(((a - b) ** 2).mean(axis=(1, 2, 3)), 1e-10))
            print('sung glow GPU dB: worst', round(float(psnr.min()), 2))
            self.assertGreaterEqual(psnr.min(), 35)


if __name__ == '__main__':
    unittest.main()
