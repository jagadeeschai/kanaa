"""A title on fire (title_fire.py): flames rise from the letters (above them, not below), nothing burns far from the
words, the loop meets itself, the same title always burns the same way, and the route makes a playable clip."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from app.services.title_fire import LOOP, FPS, STRENGTHS, Burner


def word_mask(height=270, width=480):
    alpha = np.zeros((height, width), np.float32)
    alpha[150:180, 120:360] = 1.0  # A line of 'letters'.
    return alpha


class Flames(unittest.TestCase):
    def setUp(self):
        self.burner = Burner(word_mask(), STRENGTHS['blaze'])

    def test_flames_rise_above_the_letters_not_below(self):
        frame = np.mean([self.burner.frame(n).sum(-1) for n in range(0, 120, 15)], 0)
        above, below = frame[95:148, 120:360].mean(), frame[185:240, 120:360].mean()
        self.assertGreater(above, 4 * below)
        self.assertLess(frame[:, :60].mean(), 0.02)  # Nothing burns far to the side of the words.

    def test_the_loop_meets_itself_and_frames_are_the_same_every_time(self):
        total = round(LOOP * FPS)
        np.testing.assert_allclose(self.burner.frame(0), self.burner.frame(total))
        np.testing.assert_allclose(Burner(word_mask(), STRENGTHS['blaze']).frame(37), self.burner.frame(37))
        self.assertGreater(np.abs(self.burner.frame(0) - self.burner.frame(20)).mean(), 0.002)  # It moves.

    def test_a_stronger_fire_burns_taller(self):
        heights = {}
        for name in ('glow', 'inferno'):
            frame = np.mean([Burner(word_mask(), STRENGTHS[name]).frame(n).sum(-1) for n in range(0, 120, 20)], 0)
            profile = frame[:150, 120:360].mean(1)  # Above the letters (they start at row 150).
            body = np.nonzero(profile > 0.2 * profile[140:150].max())[0]  # The flames themselves, not the odd ember.
            heights[name] = 150 - body.min()
        self.assertGreater(heights['inferno'], heights['glow'] * 1.3)


class Route(unittest.TestCase):
    def test_a_title_becomes_a_playable_burning_clip(self):
        from fastapi.testclient import TestClient
        from app.main import app
        with tempfile.TemporaryDirectory() as folder, patch('app.core.config.settings.data_dir', Path(folder)):
            (Path(folder) / 'media').mkdir()
            client = TestClient(app)
            body = {'text': {'id': 't', 'start': 0, 'length': 4, 'text': 'தமிழா!', 'style': 'shadow', 'position': 'center', 'color': '#ffffff', 'size': 60,
                             'transform': {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0}},
                    'format': {'width': 640, 'height': 360, 'fps': 30}, 'strength': 'blaze'}
            from app.services import title_fire
            from app.services.timeline_schema import Format, Text
            made = title_fire.make(Text.model_validate(body['text']), Format.model_validate(body['format']), 'blaze')
            self.assertTrue(made.is_file())
            import subprocess, shutil
            seconds = float(subprocess.run([shutil.which('ffprobe'), '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(made)], capture_output=True, text=True).stdout)
            self.assertAlmostEqual(seconds, LOOP, delta=0.1)
            self.assertEqual(client.post('/api/text-fire', json={**body, 'strength': 'volcano'}).status_code, 400)


if __name__ == '__main__':
    unittest.main()


class GpuMatchesCpu(unittest.TestCase):
    """The burning title is made on the GPU (native/title_fire.swift, Metal); the CPU path is its fallback and draws
    the same picture (AGENTS.md: every feature renders on the GPU)."""

    def test_the_gpu_clip_matches_the_cpu_frames(self):
        import subprocess
        from app.services import title_fire
        from app.services.timeline_schema import Format, Text
        item = Text.model_validate({'id': 't', 'start': 0, 'length': 4, 'text': 'உடனே விழி தமிழா!', 'style': 'shadow', 'position': 'center', 'color': '#ffffff', 'size': 56,
                                    'transform': {'x': 0.5, 'y': 0.6, 'scale': 1, 'opacity': 1, 'rotation': 0}})
        fmt = Format.model_validate({'width': 640, 'height': 360, 'fps': 30})
        with tempfile.TemporaryDirectory() as folder, patch('app.core.config.settings.data_dir', Path(folder)):
            (Path(folder) / 'media').mkdir()
            used = []
            real = title_fire._make_on_gpu
            with patch.object(title_fire, '_make_on_gpu', side_effect=lambda *a: used.append(1) or real(*a)):
                made = title_fire.make(item, fmt, 'blaze')
            self.assertEqual(used, [1])  # The GPU made it, not the fallback.
            from app.services.title_design import letters
            burner = Burner(letters(item, fmt, plain=False)[..., 3], STRENGTHS['blaze'])
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(made), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
            gpu = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640, 3).astype(np.float64)
            self.assertEqual(len(gpu), round(LOOP * FPS))
            for n in (0, 37, 74, 111):
                cpu = burner.frame(n) * 255
                mse = float(np.mean((gpu[n] - cpu) ** 2))
                psnr = 10 * np.log10(255 ** 2 / max(mse, 1e-9))
                self.assertGreater(psnr, 33, f'frame {n}: {psnr:.1f} dB')
