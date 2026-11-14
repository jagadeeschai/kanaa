"""Particle titles drawn as the preview draws them, pictures never scrambled, and the dreamy glow keeping warm colours."""
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from app.services import particle_frames
from app.services.timeline_schema import Text
from app.services.timeline_service import dreamy_glow_filters
from app.services.timeline_schema import DreamyGlow


def title_picture(width=480, height=270):
    """A clear frame with a solid block of 'letters' in the middle."""
    picture = np.zeros((height, width, 4), np.uint8)
    picture[120:150, 180:300] = (255, 247, 232, 255)
    return picture


class ParticleFrames(unittest.TestCase):
    def test_at_rest_the_title_is_untouched(self):
        picture = title_picture()
        self.assertTrue(np.array_equal(particle_frames.particle_frame(picture, 1.0, 1), picture))

    def test_particles_stay_near_the_title(self):
        picture = title_picture()
        frame = particle_frames.particle_frame(picture, 0.3, 1)
        rows, columns = np.nonzero(frame[..., 3])
        self.assertGreater(len(rows), 0)
        # Travel is at most 17% of the frame each way, as in the preview: nothing lands in the far corners.
        self.assertGreaterEqual(columns.min(), 180 - 0.17 * 480 - 2)
        self.assertLessEqual(columns.max(), 300 + 0.17 * 480 + 2)
        self.assertGreaterEqual(rows.min(), 120 - 0.17 * 270 - 2)
        self.assertLessEqual(rows.max(), 150 + 0.17 * 270 + 2)

    def test_particles_gather_as_the_animation_ends(self):
        picture = title_picture()
        on_place = lambda progress: (particle_frames.particle_frame(picture, progress, 1)[120:150, 180:300, 3] > 0).mean()
        self.assertLess(on_place(0.2), on_place(0.6))
        self.assertLess(on_place(0.6), on_place(0.95))

    def test_frames_follow_the_preview_timing(self):
        item = Text.model_validate({'id': 't', 'start': 0, 'length': 3, 'text': 'x', 'enter': {'preset': 'particle-form', 'duration': 0.5},
                                    'exit': {'preset': 'magic-vanish', 'duration': 0.4}})
        shown = particle_frames.moments(item, 30, 90)
        self.assertEqual(sorted(shown)[:15], list(range(15)))  # The first half second.
        self.assertEqual(shown[0], (1, 0.0))
        self.assertEqual(shown[89][0], 2)  # Magic at the end.
        self.assertNotIn(45, shown)

    def test_sequence_has_one_picture_per_frame(self):
        item = Text.model_validate({'id': 't', 'start': 0, 'length': 1, 'text': 'x', 'enter': {'preset': 'particle-form', 'duration': 0.5}})
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            still = folder / 'title.png'
            Image.fromarray(title_picture()).save(still)
            pattern = particle_frames.sequence(item, 30, 30, lambda _: still, folder, 'title')
            frames = sorted(pattern.parent.iterdir())
            self.assertEqual(len(frames), 30)
            self.assertEqual(frames[-1].resolve(), still.resolve())  # At rest: the title's own picture.
            self.assertNotEqual(frames[0].resolve(), still.resolve())


class NoScrambling(unittest.TestCase):
    def test_no_animation_scrambles_the_frame(self):
        source = Path(__file__).resolve().parents[1] / 'app' / 'services' / 'timeline_service.py'
        self.assertNotIn('shufflepixels', source.read_text(encoding='utf-8'))


class DreamyGlowColours(unittest.TestCase):
    def test_warm_colours_stay_warm(self):
        chain = ','.join(['format=gbrap', *dreamy_glow_filters(DreamyGlow(intensity=0.45, softness=0.5, warmth=0.2)), 'format=rgb24'])
        for colour in ((255, 154, 16), (255, 208, 64), (254, 176, 0)):
            out = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x%02X%02X%02X:s=64x64' % colour, '-vf', chain, '-frames:v', '1', '-f', 'rawvideo', '-'],
                                 capture_output=True, check=True).stdout
            r, g, b = out[6240:6243]
            self.assertGreater(r - b, 150, f'{colour} became {(r, g, b)}')


if __name__ == '__main__':
    unittest.main()
