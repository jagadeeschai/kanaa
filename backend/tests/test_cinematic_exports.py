"""Real encoded frame checks for letter mattes and GPU cinematic titles/transitions."""
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
from app.services.timeline_service import render_timeline, render_text_image
from app.services.title3d_render import _drawer


def frames(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True, timeout=30).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 240, 320, 3)


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
class CinematicExports(unittest.TestCase):
    def test_white_scene_is_visible_only_through_letters_then_opens(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
            root = Path(folder)
            scene = root / 'white.png'
            Image.new('RGB', (320, 240), 'white').save(scene)
            timeline = Timeline.model_validate({'format': {'width': 320, 'height': 240, 'fps': 24}, 'layers': [
                {'id': 'main', 'kind': 'video', 'items': [{'id': 'scene', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2}]},
                {'id': 'titles', 'kind': 'text', 'items': [{'id': 'title', 'text': 'KANAA', 'color': '#000000', 'style': 'plain', 'position': 'center', 'size': 72, 'start': 0, 'length': 2, 'enter': {'preset': 'fly-reveal', 'duration': 1.5}}]},
            ]})
            fact = MediaFacts(path=scene, media_type='image', width=320, height=240)
            target = root / 'export.mp4'
            render_timeline(timeline, lambda _: fact, lambda _: None, target, lambda _: None, hardware=False)
            actual = frames(target)
            text = timeline.layers[1].items[0]
            picture = root / 'title.png'
            render_text_image(text, timeline.format, picture)
            draw = _drawer(text, picture, (320, 240), 24, 48, None, None)
            for n in (0, 8, 18, 29, 35, 40):
                rgba = draw(n)[1].astype(float)
                expected = rgba[..., :3] * rgba[..., 3:4] / 255 + 255 - rgba[..., 3:4]
                mse = ((actual[n].astype(float) - expected) ** 2).mean()
                self.assertGreater(10 * np.log10(255 ** 2 / max(mse, 1e-10)), 35, f'frame {n}')
            self.assertLess(actual[8].mean(), actual[40].mean() - 30)

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('swiftc'), 'Apple GPU helper required')
    def test_gpu_wipe_and_moving_gold_glint_match_ffmpeg(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
            root = Path(folder)
            facts = {}
            for id, colour in ((1, '#326eb4'), (2, '#b43246')):
                path = root / f'{id}.png'
                Image.new('RGB', (320, 240), colour).save(path)
                facts[id] = MediaFacts(path=path, media_type='image', width=320, height=240)
            timeline = Timeline.model_validate({'format': {'width': 320, 'height': 240, 'fps': 24}, 'layers': [
                {'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1}, {'id': 'b', 'media_id': 2, 'start': 1, 'in': 0, 'out': 1, 'transition_in': {'kind': 'light-wipe', 'duration': .6}}]},
                {'id': 'titles', 'kind': 'text', 'items': [{'id': 'title', 'text': 'KANAA', 'style': 'plain', 'position': 'center', 'start': 0, 'length': 2, 'glint': True, 'depth': {'amount': .2, 'material': 'gold', 'bevel': .8, 'shine': .8}, 'transform': {'keyframes': {'x': [{'t': 0, 'v': .3}, {'t': 2, 'v': .7}]}}}]},
            ]})
            self.assertEqual(gpu_render.unsupported(timeline, facts.__getitem__), [])
            reference, target = root / 'ffmpeg.mp4', root / 'gpu.mp4'
            render_timeline(timeline, facts.__getitem__, lambda _: None, reference, lambda _: None, hardware=False)
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir = root
                tool = helper(gpu_render.SOURCE)
            gpu_render.render(timeline, facts.__getitem__, target, tool=tool)
            a, b = frames(reference), frames(target)
            self.assertEqual(a.shape, b.shape)
            mse = ((a.astype(float) - b) ** 2).mean(axis=(1, 2, 3))
            self.assertGreater(float((10 * np.log10(255 ** 2 / np.maximum(mse, 1e-10))).min()), 35)
