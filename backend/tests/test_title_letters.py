"""Letter by letter: finding each letter (whole Tamil letters), and the export moving them as the shared maths says."""
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Format, Text, Timeline
from app.services.timeline_service import letter_clusters, render_timeline
from app.services.title_letters import MAX_LETTERS, _draw, letters_for

FORMAT = Format.model_validate({'width': 640, 'height': 360, 'fps': 30})


def title(**look) -> Text:
    return Text.model_validate({'id': 't', 'start': 0, 'length': 2, 'text': 'Happy பொங்கல்', 'style': 'shadow', 'position': 'center', 'size': 60, 'color': '#ffd400', **look})


class Clusters(unittest.TestCase):
    def test_a_tamil_letter_keeps_its_vowel_sign_and_pulli(self):
        self.assertEqual(letter_clusters('பொங்கல்'), ['பொ', 'ங்', 'க', 'ல்'])
        self.assertEqual(letter_clusters('கொஞ்சம் தமிழ்'), ['கொ', 'ஞ்', 'ச', 'ம்', ' ', 'த', 'மி', 'ழ்'])
        self.assertEqual(letter_clusters('Hi!'), ['H', 'i', '!'])


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Letters(unittest.TestCase):
    def test_every_letter_is_found_and_every_visible_pixel_belongs_to_one(self):
        for look, count in (({}, 9), ({'font': 'Futura', 'subtitle': 'கொஞ்சம் தமிழ்', 'style': 'outline'}, 16), ({'style': 'outline'}, 9)):
            with self.subTest(**look):
                item = title(**look)
                labels, boxes = letters_for(item, FORMAT)
                self.assertEqual(len(boxes), count)
                visible = _draw(item, FORMAT, None)[..., 3] > 0
                self.assertGreater((labels > 0)[visible].mean(), 0.999)
                lines = {}
                for box in boxes:
                    lines.setdefault(box[1] // 40, []).append(box)
                for row in lines.values():
                    middles = [(b[0] + b[2]) / 2 for b in row]
                    self.assertEqual(middles, sorted(middles), 'reading order, left to right')
                widths = sorted(b[2] - b[0] for b in boxes)
                self.assertLess(widths[-1], 0.3 * 640, 'no letter spreads across the title')

    def test_a_band_box_stays_and_a_laid_out_title_has_no_letters(self):
        labels, boxes = letters_for(title(style='band', text='WAIT'), FORMAT)
        self.assertEqual(len(boxes), 4)
        picture = _draw(title(style='band', text='WAIT'), FORMAT, None)
        self.assertGreater(((labels == 0) & (picture[..., 3] > 0)).sum(), 500, "the band's box belongs to no letter")
        self.assertEqual(letters_for(title(design='formal', subtitle='x'), FORMAT)[1], [])

    def test_long_titles_move_in_at_most_sixty_four_groups(self):
        labels, boxes = letters_for(title(text=' '.join(['abcdefghi'] * 9), size=20), FORMAT)  # 81 letters, wrapped.
        self.assertEqual(len(boxes), MAX_LETTERS)
        self.assertEqual(int(labels.max()), MAX_LETTERS)

    def test_the_preview_gets_the_same_letters(self):
        from app.core.config import settings
        from app.main import app
        saved = settings.data_dir
        with tempfile.TemporaryDirectory() as folder:
            settings.data_dir = Path(folder)
            try:
                body = {'text': title().model_dump(by_alias=True), 'format': FORMAT.model_dump()}
                answer = TestClient(app).post('/api/text-letters', json=body).json()
            finally:
                settings.data_dir = saved
        labels, boxes = letters_for(title(), FORMAT)
        self.assertEqual([list(box) for box in boxes], answer['boxes'])
        import base64
        sent = np.asarray(Image.open(io.BytesIO(base64.b64decode(answer['labels'].split(',', 1)[1]))))
        self.assertTrue(np.array_equal(sent, labels))


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class LetterExports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.root = Path(cls.folder.name)
        Image.new('RGB', (640, 360), (40, 40, 40)).save(cls.root / 'grey.png')
        cls.facts = {50: MediaFacts(path=cls.root / 'grey.png', media_type='image', width=640, height=360)}

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def frame(self, name: str, number: int, **look) -> np.ndarray:
        target = self.root / f'{name}.mp4'
        if not target.is_file():
            text = {**title(**look).model_dump(by_alias=True, exclude_none=True)}
            data = {'format': FORMAT.model_dump(), 'layers': [{'id': 'm', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 50, 'start': 0, 'in': 0, 'out': 2}]}, {'id': 'w', 'kind': 'text', 'items': [text]}]}
            render_timeline(Timeline.model_validate(data), self.facts.__getitem__, lambda asset: asset, target, lambda _: None)
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-vf', f'select=eq(n\\,{number})', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(360, 640, 3).astype(int)

    @staticmethod
    def yellow(frame):
        return (frame[..., 0] > 150) & (frame[..., 1] > 120) & (frame[..., 2] < 100)

    def test_each_animation_moves_letters_and_settles_to_the_plain_title(self):
        rest = self.yellow(self.frame('plain', 45))
        cols, rows = np.nonzero(rest.any(axis=0))[0], np.nonzero(rest.any(axis=1))[0]
        enter = lambda preset: {'enter': {'preset': preset, 'duration': 1}}
        with self.subTest('pop-up letters: the first letters first'):
            early = self.yellow(self.frame('pop', 9, **enter('pop-letters')))
            shown = np.nonzero(early.any(axis=0))[0]
            self.assertTrue(shown.size)
            self.assertLess(shown.max(), cols.min() + 0.6 * (cols.max() - cols.min()), 'the last letters are not up yet')
        with self.subTest('gravity: letters come down from above'):
            early = self.yellow(self.frame('gravity', 9, **enter('gravity')))
            self.assertLess(np.nonzero(early.any(axis=1))[0].min(), rows.min() - 10, 'a letter above the title')
        with self.subTest('split: letters start further apart'):
            early = self.yellow(self.frame('split', 9, **enter('split')))
            spread = np.nonzero(early.any(axis=0))[0]
            self.assertGreater(spread.max() - spread.min(), (cols.max() - cols.min()) * 1.1)
        with self.subTest('expand: letters start bunched'):
            early = self.yellow(self.frame('expand', 9, **enter('expand')))
            spread = np.nonzero(early.any(axis=0))[0]
            self.assertLess(spread.max() - spread.min(), (cols.max() - cols.min()) * 0.9)
        plain = self.frame('plain', 45)
        for preset in ('pop-letters', 'gravity', 'split', 'expand'):
            with self.subTest(f'{preset} settles'):
                self.assertLess(np.abs(self.frame(f'{preset}-settled', 45, **enter(preset)) - plain).mean(), 1.0)


if __name__ == '__main__':
    unittest.main()
