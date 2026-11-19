"""Zoom through the letters: a video-inside-text title flying 45 times bigger into one letter. Both exports draw it from
the same per-frame values (zoom_reveal.frames), the flight ends on the whole scene, and the letter found is a hole."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from app.services import gpu_render, zoom_reveal
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Format, Text, Timeline
from app.services.timeline_service import render_text_image, render_timeline

W, H, FPS = 426, 240, 24


def title(hole=(0.5, 0.5)) -> dict:
    hx, hy = hole
    s0, end = 1.8, 3.0
    sx, sy = 0.5 + (hx - 0.5) * s0, 0.5 + (hy - 0.5) * s0  # Where the letter sits on screen; it stays there.
    key = lambda v0, v1: [{'t': 0, 'v': v0, 'ease': 'linear'}, {'t': 1.6, 'v': v0, 'ease': 'easeInOut'}, {'t': end, 'v': v1}]
    return {'id': 'tt', 'start': 0, 'length': end, 'text': 'TEXT', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 100, 'knockout': '#000000',
            'enter': {'preset': 'fade', 'duration': 0.4},
            'transform': {'x': .5, 'y': .5, 'scale': s0, 'opacity': 1, 'rotation': 0, 'keyframes': {
                'scale': key(s0, 45), 'x': key(.5, sx - (hx - .5) * 45), 'y': key(.5, sy - (hy - .5) * 45),
                'opacity': [{'t': 0, 'v': 1, 'ease': 'linear'}, {'t': end - .2, 'v': 1, 'ease': 'linear'}, {'t': end, 'v': 0}]}}}


def work(hole) -> Timeline:
    return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': FPS}, 'layers': [
        {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 3}]},
        {'id': 'words', 'kind': 'text', 'items': [title(hole)]}]})


class Hole(unittest.TestCase):
    def test_the_point_found_is_inside_a_letter_and_big_titles_are_drawn_frame_by_frame(self):
        fmt = Format.model_validate({'width': W, 'height': H, 'fps': FPS})
        item = Text.model_validate(title())
        self.assertTrue(zoom_reveal.needs_frames(item))
        with self.assertRaises(ValueError):  # Only a video-inside title may grow that far.
            Text.model_validate({**title(), 'knockout': None})
        self.assertFalse(zoom_reveal.needs_frames(Text.model_validate({**title(), 'transform': {'x': .5, 'y': .5, 'scale': 1.8, 'opacity': 1}})))
        with tempfile.TemporaryDirectory() as folder:
            picture = Path(folder) / 'card.png'
            render_text_image(item.model_copy(update={'transform': item.transform.model_copy(update={'keyframes': {}})}), fmt, picture)
            x, y = zoom_reveal.deepest_point(picture)
            alpha = np.asarray(Image.open(picture).convert('RGBA'))[..., 3]
        self.assertLess(alpha[int(y * H), int(x * W)], 30)


@unittest.skipUnless(shutil.which('ffmpeg') and sys.platform == 'darwin' and shutil.which('swiftc'), 'needs ffmpeg and Metal')
class FlightOnTheGpu(unittest.TestCase):
    def test_both_exports_fly_in_alike_and_end_on_the_scene(self):
        from app.services.cutout_service import helper
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            yy, xx = np.mgrid[:H, :W]
            scene = np.stack([xx * 255 // W, yy * 255 // H, 120 + 60 * np.sin(xx / 17) * np.cos(yy / 13)], 2).astype(np.uint8)
            Image.fromarray(scene).save(root / '1.png')
            facts = {1: MediaFacts(path=root / '1.png', media_type='image', width=W, height=H)}
            fmt = Format.model_validate({'width': W, 'height': H, 'fps': FPS})
            card = root / 'card.png'
            render_text_image(Text.model_validate({**title(), 'transform': {'x': .5, 'y': .5, 'scale': 1, 'opacity': 1}}), fmt, card)
            timeline = work(zoom_reveal.deepest_point(card))
            self.assertEqual(gpu_render.unsupported(timeline, facts.__getitem__), [])
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir = root
                tool = helper(gpu_render.SOURCE)
            read = lambda path: np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']), np.uint8).reshape(-1, H, W, 3).astype(float)
            cpu, gpu = root / 'cpu.mp4', root / 'gpu.mp4'
            render_timeline(timeline, facts.__getitem__, lambda _: None, cpu, lambda _: None, hardware=False)
            gpu_render.render(timeline, facts.__getitem__, gpu, tool=tool)
            a, b = read(cpu), read(gpu)
            self.assertEqual(a.shape, b.shape)
            db = 10 * np.log10(255 ** 2 / np.maximum(((a - b) ** 2).mean(axis=(1, 2, 3)), 1e-10))
            print(f'zoom reveal GPU dB: worst {db.min():.2f}')
            self.assertGreaterEqual(db.min(), 35)
            before, last = a[30], a[-2]
            self.assertGreater((before.max(axis=2) < 10).mean(), 0.5, 'mostly black card with the letters before the flight')
            self.assertLess((last.max(axis=2) < 10).mean(), 0.02, 'the scene fills the frame at the end')


if __name__ == '__main__':
    unittest.main()
