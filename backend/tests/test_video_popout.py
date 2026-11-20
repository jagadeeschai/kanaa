"""Video pop-out: the scene clip (dimmed, with its pop-out record) and the person's moving cut-out validate and stay on
the GPU engine (frontend/tests/video-popout.test.mjs builds the same)."""
import unittest
from pathlib import Path

from app.services import gpu_render
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Timeline

ADJUST = {'rotation': 0, 'flip_horizontal': False, 'flip_vertical': False, 'brightness': 1, 'contrast': 1, 'saturation': 1, 'gamma': 1, 'temperature': 1, 'tint': 1, 'fade': 0}


def popped() -> Timeline:
    grow = {'scale': [{'t': 0, 'v': 1, 'ease': 'easeInOut'}, {'t': 6, 'v': 1.2}], 'x': [{'t': 0, 'v': .5, 'ease': 'easeInOut'}, {'t': 6, 'v': .48}]}
    return Timeline.model_validate({'format': {'width': 640, 'height': 360, 'fps': 30}, 'layers': [
        {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'v', 'media_id': 1, 'start': 0, 'in': 2, 'out': 8, 'frame_locked': True,
            'adjust': {**ADJUST, 'brightness': 0.88, 'saturation': 0.9},
            'popout': {'original_media_id': 1, 'person_clip_id': 'p', 'softened': True, 'original_adjust': ADJUST}}]},
        {'id': 'pop', 'kind': 'video', 'name': 'Pop-out', 'items': [{'id': 'p', 'media_id': 1, 'start': 0, 'in': 2, 'out': 8, 'muted': True, 'volume': 0,
            'cutout': 'remove', 'cutout_pick': {'kind': 'people', 'ids': [2]}, 'transform': {'x': .5, 'y': .5, 'scale': 1, 'opacity': 1, 'keyframes': grow}}]}]})


class VideoPopout(unittest.TestCase):
    def test_valid_and_on_the_gpu(self):
        facts = {1: MediaFacts(path=Path('v.mp4'), media_type='video', width=1920, height=1080, duration=10, fps=30)}
        self.assertEqual(gpu_render.unsupported(popped(), facts.__getitem__), [])


if __name__ == '__main__':
    unittest.main()
