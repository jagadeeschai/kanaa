"""Letter-trick and 3D titles: a still stretch is drawn once (same frames as drawing each), and the GPU engine takes them."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.services import gpu_render, title3d_render
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Format, Text, Timeline
from app.services.timeline_service import render_text_image

FMT = Format(width=640, height=360, fps=30)


def title(**extra):
    return Text.model_validate({'id': 't', 'start': 0, 'length': 3, 'text': 'தமிழும் நானும்', 'style': 'shadow', 'size': 48,
                                'enter': {'preset': 'pop-letters', 'duration': 0.6}, 'exit': {'preset': 'fade', 'duration': 0.4}, **extra})


class StillStretch(unittest.TestCase):
    def test_after_the_entrance_and_before_the_exit(self):
        self.assertEqual(title3d_render.still_from(title(), 3), (0.6, 2.6))
        self.assertIsNone(title3d_render.still_from(title(transform={'keyframes': {'x': [{'t': 0, 'v': 0.4}, {'t': 3, 'v': 0.6}]}}), 3))

    def test_drawn_once_and_identical_to_drawing_each_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder); text = title(); picture = folder / 't.png'
            render_text_image(text, FMT, picture)
            cached = title3d_render._drawer(text, picture, (640, 360), 30, 90, None, None)
            for n in (0, 9, 18, 30, 45, 70, 80, 89):
                fresh = title3d_render._drawer(text, picture, (640, 360), 30, 90, None, None)
                self.assertTrue(np.array_equal(cached(n)[1], fresh(n)[1]), n)
            paths, shown = title3d_render.render_title_sequence(text, picture, (640, 360), 30, 90, folder, 'seq')
            self.assertEqual(len(shown), 90)
            self.assertLess(len(paths), 40)  # The entrance, the exit and one still frame.
            self.assertEqual(len(set(shown[20:75])), 1)


class GpuTakesThem(unittest.TestCase):
    facts = staticmethod(lambda _: MediaFacts(path=Path('x.png'), media_type='image', width=640, height=360))

    def timeline(self, **extra):
        return Timeline.model_validate({'format': {'width': 640, 'height': 360, 'fps': 30}, 'layers': [
            {'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 4}]},
            {'id': 'words', 'kind': 'text', 'items': [title(**extra).model_dump(by_alias=True, mode='json')]}]})

    def test_letter_tricks_and_depth_are_drawn(self):
        self.assertEqual(gpu_render.unsupported(self.timeline(), self.facts), [])
        self.assertEqual(gpu_render.unsupported(self.timeline(depth={'amount': 0.5}), self.facts), [])

    def test_pinned_titles_stay_with_ffmpeg(self):
        self.assertEqual(gpu_render.unsupported(self.timeline(pin={'clip_id': 'c', 'at': 0.5}), self.facts), ['pinned titles'])


if __name__ == '__main__':
    unittest.main()
