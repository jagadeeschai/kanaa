import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from app.services import gpu_render
from app.services.compare_graphics import compare_states, split_at
from app.services.explainer_graphics import state_at
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Text, Timeline
from app.services.timeline_service import render_timeline

W, H, FPS = 426, 240, 24


def divider(**changes):
    graphic = {'kind': 'compare-divider', 'style': 'clean', 'from': [.5, .5], 'to': [.5, .5], 'width': 1, 'height': 1, 'line_width': .006,
               'compare_clip': 'after', 'split_from': 1, 'split_to': .5, 'split_delay': .25, 'split_move': .6, 'before_label': 'முன்', 'after_label': 'பின்', **changes}
    return {'id': 'split', 'start': .5, 'length': 1.5, 'text': 'Before / after', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 44, 'graphic': graphic}


def timeline(**changes):
    return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': FPS}, 'layers': [
        {'id': 'main', 'kind': 'video', 'items': [{'id': 'before', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2}]},
        {'id': 'top', 'kind': 'video', 'items': [{'id': 'after', 'media_id': 2, 'start': .5, 'in': 0, 'out': 1.5}]},
        {'id': 'graphics', 'kind': 'text', 'name': 'Graphics', 'items': [divider(**changes)]}]})


class CompareSplit(unittest.TestCase):
    def test_divider_needs_its_clip_and_steps_through_the_slide(self):
        data = divider(); data['graphic']['compare_clip'] = None
        with self.assertRaises(ValueError): Text.model_validate(data)
        item = Text.model_validate(divider()); states = compare_states(item, FPS)
        self.assertEqual(states[0], 0); self.assertAlmostEqual(states[-1], .85)
        self.assertEqual(split_at(item.graphic, 0, FPS), 1); self.assertEqual(split_at(item.graphic, 5, FPS), .5)
        self.assertEqual(state_at(item, .25 + 3 / FPS, FPS), states.index(min(states, key=lambda s: abs(s - (.25 + 3 / FPS)))))

    def test_no_style_covers_the_frame(self):
        from app.services.compare_graphics import render_compare
        from app.services.timeline_schema import Format
        for style in ('clean', 'documentary', 'dark-band', 'bold-colour'):
            item = Text.model_validate(divider(style=style))
            alpha = np.asarray(render_compare(item, Format(width=W, height=H, fps=FPS), 1))[:, :, 3]
            self.assertLess(np.count_nonzero(alpha) / alpha.size, .08, style)   # only the line, handle and two labels

    def test_gpu_engine_hands_a_split_to_ffmpeg(self):
        facts = {1: MediaFacts(path=Path('a.png'), media_type='image', width=W, height=H), 2: MediaFacts(path=Path('b.png'), media_type='image', width=W, height=H)}
        self.assertIn('before / after split', gpu_render.unsupported(timeline(), facts.__getitem__))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
    def test_export_reveals_the_after_clip_exactly_right_of_the_line(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            Image.new('RGB', (W, H), (200, 30, 30)).save(root / 'a.png'); Image.new('RGB', (W, H), (30, 30, 200)).save(root / 'b.png')
            facts = {1: MediaFacts(path=root / 'a.png', media_type='image', width=W, height=H), 2: MediaFacts(path=root / 'b.png', media_type='image', width=W, height=H)}
            target = root / 'out.mp4'; plan = timeline(before_label='', after_label='')
            render_timeline(plan, facts.__getitem__, lambda _: None, target, lambda _: None, hardware=False)
            video = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout, np.uint8).reshape(-1, H, W, 3).astype(int)
            graphic = plan.layers[2].items[0].graphic; row = 20   # well above the handle
            checked = 0
            for number in range(round(.5 * FPS) + 1, round(2 * FPS) - 1):
                expected = split_at(graphic, (number - round(.5 * FPS)) / FPS, FPS) * W
                line = video[number, row]
                blue = np.nonzero(line[:, 2] - line[:, 0] > 80)[0]; white = np.nonzero(line.min(axis=1) > 180)[0]
                with self.subTest(frame=number):
                    if expected < W - 3:
                        self.assertGreater(len(blue), 0)
                        self.assertLessEqual(abs(blue.min() - expected), 5)                       # after shows right of the divider (under the line's half-width and shadow)
                        self.assertLessEqual(abs(white.mean() - expected), 2)                     # and the line is on that edge
                        self.assertGreater(line[: max(1, int(expected) - 4), 0].min(), 150)        # before still shows left of it
                    else:
                        self.assertEqual(len(blue), 0)
                    checked += 1
            self.assertGreater(checked, 25)


if __name__ == '__main__': unittest.main()
