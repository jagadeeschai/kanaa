"""Word by word: each word of a title arrives on its own, as it is sung on a karaoke line, in the export and on the GPU."""
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

from app.services.animation import WORD_LEAD, WORD_SECONDS, letter_looks, word_start
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Text, Timeline
from app.services.timeline_service import render_timeline
from app.services.title_letters import MAX_LETTERS, word_numbers

W, H, FPS = 640, 360, 30


def title(**look) -> Text:
    return Text.model_validate({'id': 't', 'start': 0, 'length': 2, 'text': 'Happy பொங்கல்', 'style': 'shadow', 'position': 'center',
                                'size': 60, 'color': '#ffd400', **look})


SUNG = {'karaoke': {'color': '#ffd400', 'words': [0.2, 1.0]}, 'enter': {'preset': 'word-rise', 'duration': 0.5}}


class WordMaths(unittest.TestCase):
    def test_letters_know_their_words(self):
        self.assertEqual(word_numbers(title()), [0] * 5 + [1] * 4)
        self.assertEqual(word_numbers(title(text='ஒரு  நாள்', subtitle='one day')), [0, 0, 1, 1, 2, 2, 2, 3, 3, 3])
        long = word_numbers(title(text=' '.join(['abcdefghi'] * 9)))
        self.assertEqual(len(long), MAX_LETTERS)
        self.assertEqual(long, sorted(long))

    def test_sung_words_arrive_as_they_are_sung(self):
        self.assertEqual(word_start(1, 2, [0.2, 1.0], 0.5), (1.0 - WORD_LEAD, WORD_SECONDS))
        enter = title(**SUNG).enter
        looks = letter_looks(enter, None, 0.5, 2, [0] * 9, word_numbers(title()), [0.2, 1.0])
        self.assertTrue(all(look['opacity'] == 1 for look in looks[:5]), 'Happy is in')
        self.assertTrue(all(look['opacity'] == 0 for look in looks[5:]), 'பொங்கல் is not sung yet')
        settled = letter_looks(enter, None, 1.6, 2, [0] * 9, word_numbers(title()), [0.2, 1.0])
        self.assertTrue(all(look == {'dx': 0, 'dy': 0, 'scale': 1, 'opacity': 1} for look in settled))

    def test_without_karaoke_words_follow_each_other_across_the_entrance(self):
        enter = title(enter={'preset': 'word-pop', 'duration': 1}).enter
        early = letter_looks(enter, None, 0.3, 2, [0] * 9, word_numbers(title()), None)
        self.assertGreater(early[0]['opacity'], 0)
        self.assertEqual(early[-1]['opacity'], 0)


def read(path: Path) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(int)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class WordExports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.root = Path(cls.folder.name)
        Image.new('RGB', (W, H), (40, 40, 40)).save(cls.root / 'grey.png')
        cls.facts = {50: MediaFacts(path=cls.root / 'grey.png', media_type='image', width=W, height=H)}

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def timeline(self, **look) -> Timeline:
        text = title(**look).model_dump(by_alias=True, exclude_none=True)
        return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': FPS}, 'layers': [
            {'id': 'm', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 50, 'start': 0, 'in': 0, 'out': 2}]}, {'id': 'w', 'kind': 'text', 'items': [text]}]})

    def export(self, name: str, **look) -> np.ndarray:
        target = self.root / f'{name}.mp4'
        with patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
            render_timeline(self.timeline(**look), self.facts.__getitem__, lambda asset: asset, target, lambda _: None, hardware=False)
        return read(target)

    @staticmethod
    def yellow(frame):
        return (frame[..., 0] > 150) & (frame[..., 1] > 120) & (frame[..., 2] < 100)

    def test_each_word_arrives_when_sung_and_settles_to_the_karaoke_title(self):
        plain = self.export('plain', karaoke=SUNG['karaoke'])
        moving = self.export('words', **SUNG)
        rest = self.yellow(plain[50])
        cols = np.nonzero(rest.any(axis=0))[0]
        middle = cols.min() + 0.5 * (cols.max() - cols.min())
        before = self.yellow(moving[0])
        self.assertLess(before.sum(), 20, 'nothing before the first word is sung')
        happy = self.yellow(moving[18])  # 0.6 s: Happy is in, பொங்கல் is sung at 1.0 s.
        shown = np.nonzero(happy.any(axis=0))[0]
        self.assertTrue(shown.size)
        self.assertLess(shown.max(), middle, 'only the first word is in')
        rising = self.yellow(moving[33])  # 1.1 s: பொங்கல் on its way up, below where it rests.
        right = np.s_[:, int(middle):]
        rows_rising, rows_rest = np.nonzero(rising[right].any(axis=1))[0], np.nonzero(rest[right].any(axis=1))[0]
        self.assertTrue(rows_rising.size)
        self.assertGreater(rows_rising.mean(), rows_rest.mean() + 2, 'the second word rises into place')
        for n in (50, 59):
            self.assertLess(np.abs(moving[n] - plain[n]).mean(), 1.0, f'settled at frame {n}')

    def test_the_gpu_draws_the_same_words(self):
        if not (sys.platform == 'darwin' and shutil.which('swiftc')):
            self.skipTest('Metal requires Mac')
        from app.services import gpu_render
        from app.services.cutout_service import helper
        timeline = self.timeline(**SUNG)
        self.assertEqual(gpu_render.unsupported(timeline, self.facts.__getitem__), [])
        cpu = self.export('cpu', **SUNG)
        with patch('app.services.cutout_service.settings') as settings:
            settings.data_dir = self.root
            tool = helper(gpu_render.SOURCE)
        target = self.root / 'gpu.mp4'
        gpu_render.render(timeline, self.facts.__getitem__, target, tool=tool)
        gpu = read(target)
        mse = ((cpu.astype(float) - gpu) ** 2).mean(axis=(1, 2, 3))
        psnr = 10 * np.log10(255 ** 2 / np.maximum(mse, 1e-10))
        print('word motion GPU dB: worst', round(float(psnr.min()), 2), 'average', round(float(psnr.mean()), 2))
        self.assertGreaterEqual(psnr.min(), 35)


if __name__ == '__main__':
    unittest.main()
