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
from app.services.timeline_schema import Format, Text, Timeline
from app.services.timeline_service import render_text_image, render_timeline
from app.services.explainer_graphics import count_value, format_count, render, state_at, state_count


KINDS = ('arrow-straight', 'arrow-curved', 'circle', 'box', 'callout')


def item(kind, style='clean'):
    return Text.model_validate({'id': kind, 'start': 0, 'length': 1, 'text': 'தமிழ் label', 'style': 'plain', 'position': 'center', 'color': '#f5c11b', 'size': 36,
        'enter': {'preset': 'reveal', 'duration': .5}, 'graphic': {'kind': kind, 'style': style, 'from': [.2, .25], 'to': [.7, .65], 'width': .3, 'height': .22, 'line_width': .012}})


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
class ExplainerGraphics(unittest.TestCase):
    def test_state_formula_matches_preview_examples_and_count_up_density(self):
        arrow = item('arrow-straight')
        self.assertEqual([state_at(arrow, at, 24) for at in (0, .2, .4, .6, .8, 1)], [0, 18, 23, 23, 23, 23])
        count_up = arrow.model_copy(update={'length_': 3, 'graphic': arrow.graphic.model_copy(update={'kind': 'count-up'}), 'enter': arrow.enter.model_copy(update={'duration': 2})}, deep=True)
        self.assertEqual(state_count(count_up, 30), 61)
        self.assertEqual(state_at(count_up, 2, 30), 60)
        self.assertEqual(state_count(count_up.model_copy(update={'enter': count_up.enter.model_copy(update={'duration': 8})}), 60), 90)

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

    def test_lower_third_styles_tamil_role_and_reverse_exit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); fmt = Format(width=480, height=270, fps=30)
            base = item('callout').model_dump(by_alias=True)
            base.update({'id': 'lower', 'length': 3, 'text': 'கலையரசி', 'exit': {'preset': 'reveal', 'duration': .5}})
            base['graphic'].update({'kind': 'lower-third', 'from': [.07, .78], 'to': [.07, .78], 'width': .42, 'height': .14, 'role': 'ஆய்வாளர்'})
            for style in ('clean', 'documentary', 'dark-band', 'bold-colour'):
                lower = Text.model_validate({**base, 'graphic': {**base['graphic'], 'style': style}})
                target = root / f'lower-{style}.png'; render_text_image(lower, fmt, target)
                self.assertGreater(np.count_nonzero(np.asarray(Image.open(target))[:, :, 3]), 100)
            lower = Text.model_validate(base)
            self.assertGreater(state_at(lower, .7, 30), state_at(lower, 2.8, 30))

    def test_lower_third_panel_fits_name_and_role_on_a_small_frame(self):
        # The role line once spilled under the panel's line and off the bottom of a small frame.
        with tempfile.TemporaryDirectory() as folder:
            for width, height in ((426, 240), (1920, 1080)):
                base = item('callout').model_dump(by_alias=True)
                base.update({'id': 'lower', 'length': 3, 'text': 'கனா Kanaa'})
                base['graphic'].update({'kind': 'lower-third', 'style': 'dark-band', 'from': [.07, .78], 'to': [.07, .78], 'width': .42, 'height': .14, 'role': 'இயக்குநர் · Director'})
                target = Path(folder) / f'{height}.png'
                render_text_image(Text.model_validate(base), Format(width=width, height=height, fps=24), target)
                alpha = np.asarray(Image.open(target))[:, :, 3]
                rows = np.nonzero(alpha.max(axis=1))[0]
                panel = np.nonzero(alpha[:, :].max(axis=1) > 200)[0]
                self.assertLess(rows.max(), height - 1, (width, height))     # nothing runs off the bottom
                self.assertEqual(rows.max() - panel.max(), 0, (width, height))  # nothing hangs below the panel's line

    def test_count_up_easing_formatting_and_exact_end(self):
        data = item('callout').model_dump(by_alias=True)
        data.update({'id': 'count', 'length': 3, 'text': 'Count-up number', 'enter': {'preset': 'reveal', 'duration': 2}})
        data['graphic'].update({'kind': 'count-up', 'count_from': 0, 'count_to': 200000, 'label': 'ஆண்டுகள்', 'prefix': '₹', 'suffix': '+', 'indian_grouping': True, 'tamil_numerals': True})
        count = Text.model_validate(data)
        self.assertEqual(format_count(200000, True, False), '2,00,000')
        self.assertEqual(format_count(200000, True, True), '௨,௦௦,௦௦௦')
        self.assertEqual(count_value(count.graphic, 0), 0)
        self.assertEqual(count_value(count.graphic, 1), 200000)
        self.assertGreater(state_at(count, .5, 30), round((.5 / 2) * (state_count(count, 30) - 1)))
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'count.png'; render_text_image(count, Format(width=480, height=270, fps=30), target)
            self.assertGreater(np.count_nonzero(np.asarray(Image.open(target))[:, :, 3]), 100)

    def test_chapter_card_full_and_corner_styles_render_tamil(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); fmt = Format(width=480, height=270, fps=24)
            data = item('callout').model_dump(by_alias=True)
            data.update({'id': 'chapter', 'text': 'பகுதி 2 — சங்க காலம்'})
            data['graphic'].update({'kind': 'chapter-card', 'from': [.5, .5], 'to': [.08, .12], 'width': .42, 'height': .22})
            for mode in ('full', 'corner'):
                for style in ('clean', 'documentary', 'dark-band', 'bold-colour'):
                    chapter = Text.model_validate({**data, 'graphic': {**data['graphic'], 'card_mode': mode, 'style': style}})
                    target = root / f'{mode}-{style}.png'; render_text_image(chapter, fmt, target)
                    alpha = np.asarray(Image.open(target))[:, :, 3]
                    self.assertGreater(np.count_nonzero(alpha), 100)
                    if mode == 'full': self.assertGreater(np.count_nonzero(alpha[:, 0]), 100)

    def test_reference_and_gpu_export_match_staged_stroke(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
            root = Path(folder); base = root / 'base.png'; Image.new('RGB', (320, 240), (24, 30, 40)).save(base)
            facts = {1: MediaFacts(path=base, media_type='image', width=320, height=240)}
            timeline = Timeline.model_validate({'format': {'width': 320, 'height': 240, 'fps': 24}, 'layers': [
                {'id': 'main', 'kind': 'video', 'items': [{'id': 'base', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1}]},
                {'id': 'graphics', 'kind': 'text', 'name': 'Graphics', 'items': [item('arrow-curved', 'documentary').model_dump(by_alias=True)]},
            ]})
            self.assertEqual(gpu_render.unsupported(timeline, facts.__getitem__), [])
            target = root / 'graphic.mp4'
            render_timeline(timeline, facts.__getitem__, lambda _: None, target, lambda _: None, hardware=False)
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
            frames = np.frombuffer(raw, np.uint8).reshape(-1, 240, 320, 3)
            base_colour = np.array([24, 30, 40])
            early = np.linalg.norm(frames[1].astype(int) - base_colour, axis=2) > 30
            settled = np.linalg.norm(frames[18].astype(int) - base_colour, axis=2) > 30
            self.assertGreater(settled.sum(), early.sum())
            self.assertGreater(settled.sum(), 100)
            if sys.platform == 'darwin' and shutil.which('swiftc'):
                with patch('app.services.cutout_service.settings') as settings:
                    settings.data_dir = root
                    tool = helper(gpu_render.SOURCE)
                gpu = root / 'graphic-gpu.mp4'
                gpu_render.render(timeline, facts.__getitem__, gpu, tool=tool)
                gpu_frames = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(gpu), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout, np.uint8).reshape(-1, 240, 320, 3)
                self.assertEqual(frames.shape, gpu_frames.shape)
                mse = ((frames.astype(float) - gpu_frames) ** 2).mean(axis=(1, 2, 3))
                psnr = 10 * np.log10(255 ** 2 / np.maximum(mse, 1e-10))
                self.assertGreaterEqual(float(psnr.min()), 35, psnr)

    def test_draw_progress_and_callout_stay_inside_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); fmt = Format(width=320, height=240, fps=24)
            counts = []
            for number, progress in enumerate((0, .25, .5, .75, 1)):
                target = root / f'arrow-{number}.png'
                render_text_image(item('arrow-curved', 'hand-drawn'), fmt, target, graphic_progress=progress)
                counts.append(np.count_nonzero(np.asarray(Image.open(target))[:, :, 3]))
            self.assertEqual(counts, sorted(counts))
            edge = item('callout', 'documentary').model_copy(update={'graphic': item('callout').graphic.model_copy(update={'to': (.97, .5)})})
            target = root / 'edge.png'; render_text_image(edge, fmt, target)
            alpha = np.asarray(Image.open(target))[:, :, 3]
            self.assertGreater(np.count_nonzero(alpha[:, :160]), 100)
            self.assertEqual(np.count_nonzero(alpha[:, -1]), 0)


class CountUpFits(unittest.TestCase):
    def test_a_long_label_at_the_largest_size_stays_inside_the_frame(self):
        import numpy as np
        from PIL import Image
        item = Text.model_validate({'id': 'n', 'start': 0, 'length': 3, 'text': 'n', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 100,
            'graphic': {'kind': 'count-up', 'style': 'documentary', 'from': [.5, .5], 'to': [.5, .42], 'width': .56, 'height': .34, 'line_width': .006,
                        'count_from': 0, 'count_to': 9, 'suffix': '%', 'label': 'அமெரிக்கத் தொழிலாளர்கள் · அடுத்த 10 ஆண்டுகள் (கணிப்பு) · மிக நீளமான குறிப்பு'}})
        for width, height in ((426, 240), (1920, 1080)):
            with tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / 'n.png'; render(item, Format(width=width, height=height, fps=24), target, 1)
                alpha = np.asarray(Image.open(target))[:, :, 3]; ys, xs = np.nonzero(alpha)
                self.assertGreater(xs.min(), 0, width); self.assertLess(xs.max(), width - 1, width)


if __name__ == '__main__':
    unittest.main()
