"""Laid-out titles (gradient and formal bars, overlap, four corners) and the date a clip was filmed, for Date titles."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.services.media_probe import recorded_at
from app.services.timeline_schema import Format, Text
from app.services.title_design import BAR_OPACITY, box_of, design_picture

FORMAT = Format.model_validate({'width': 640, 'height': 360, 'fps': 30})


def title(**look) -> Text:
    return Text.model_validate({'id': 't', 'start': 0, 'length': 2, 'text': 'Meena Kumar', 'subtitle': 'மதுரை 2026', 'style': 'shadow', 'color': '#ffffff', 'size': 40, **look})


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Designs(unittest.TestCase):
    def test_a_gradient_bar_is_solid_under_the_words_and_fades_out_to_the_right(self):
        picture = design_picture(title(design='gradient', position='bottom'), FORMAT)
        words = box_of(design_picture(title(design=None, position='bottom', align='left'), FORMAT))
        row = (words[1] + words[3]) // 2
        alpha = picture[row, :, 3]
        self.assertAlmostEqual(float(alpha[2]), BAR_OPACITY, delta=0.02, msg='the bar starts at the left edge')
        beyond = alpha[words[2] + 20:]
        self.assertTrue(np.all(np.diff(beyond) <= 1e-6), 'fading out, never back')
        self.assertLess(float(alpha[-1]), 0.05 if words[2] + 0.35 * 640 < 640 else 1)
        self.assertEqual(float(picture[: max(0, words[1] - 30), :, 3].max()), 0, 'nothing above the bar')

    def test_the_bar_takes_the_band_colour(self):
        picture = design_picture(title(design='gradient', position='bottom', band_color='#ffffff', color='#1f2937'), FORMAT)
        box = box_of(picture)
        corner = picture[box[1] + 2, 2]
        self.assertGreater(corner[:3].min(), 0.95)

    def test_a_formal_bar_crosses_the_frame_with_two_rules(self):
        picture = design_picture(title(design='formal', position='bottom', color='#3b2f1e'), FORMAT)
        box = box_of(picture)
        self.assertEqual((box[0], box[2]), (0, 640), 'right across the frame')
        gold = (np.abs(picture[..., :3] - np.array([0xb0, 0x8d, 0x57]) / 255).max(axis=2) < 0.02) & (picture[..., 3] > 0.99)
        rows = np.nonzero(gold.mean(axis=1) > 0.8)[0]
        self.assertGreaterEqual(len(rows), 2)
        self.assertGreater(rows.max() - rows.min(), 20, 'one rule above the words, one below')

    def test_overlap_tucks_the_subtitle_over_the_end_of_the_title_and_keeps_both_whole(self):
        look = dict(text='Pongal', subtitle='பொங்கல்', size=84, subtitle_size=54, color='#ef4444', subtitle_color='#ffffff', position='center')
        picture = design_picture(title(design='overlap', **look), FORMAT)
        red = (picture[..., 0] > 0.8) & (picture[..., 1] < 0.4) & (picture[..., 3] > 0.9)
        white = (picture[..., :3].min(axis=2) > 0.9) & (picture[..., 3] > 0.9)
        red_cols, white_cols = np.nonzero(red.any(axis=0))[0], np.nonzero(white.any(axis=0))[0]
        self.assertLess(white_cols.min(), red_cols.max(), 'the subtitle starts before the title ends')
        self.assertGreater(white_cols.max(), red_cols.max(), 'and carries on past it')
        self.assertEqual(float(picture[:, :2, 3].max() + picture[:, -2:, 3].max()), 0, 'neither part cut at the frame edges')

    def test_four_corners_puts_the_title_top_left_and_the_subtitle_bottom_right(self):
        picture = design_picture(title(design='corners', subtitle='12 March', color='#ffffff', subtitle_color='#ffd400'), FORMAT)
        white = (picture[..., :3].min(axis=2) > 0.9) & (picture[..., 3] > 0.9)
        yellow = (picture[..., 2] < 0.3) & (picture[..., 1] > 0.7) & (picture[..., 3] > 0.9)
        wr, wc = np.nonzero(white); yr, yc = np.nonzero(yellow)
        self.assertLess(wr.max(), 120); self.assertLess(wc.min(), 60)
        self.assertGreater(yr.min(), 240); self.assertGreater(yc.max(), 580)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class TextPictures(unittest.TestCase):
    def setUp(self):
        from app.core.config import settings
        self.folder = tempfile.TemporaryDirectory()
        self.saved = settings.data_dir
        settings.data_dir = Path(self.folder.name)
        from app.main import app
        self.client = TestClient(app)

    def tearDown(self):
        from app.core.config import settings
        settings.data_dir = self.saved
        self.folder.cleanup()

    def picture(self, **look):
        response = self.client.post('/api/text-image', json={'text': {'id': 't', 'start': 0, 'length': 2, 'text': 'Spacing', 'style': 'shadow', **look}, 'format': {'width': 640, 'height': 360, 'fps': 30}})
        self.assertEqual(response.status_code, 200)
        return box_of(np.asarray(Image.open(__import__('io').BytesIO(response.content)).convert('RGBA'), np.float32) / 255)

    def test_letter_spacing_and_layout_each_make_a_new_picture(self):
        plain, spaced = self.picture(), self.picture(spacing=20)
        self.assertGreater(spaced[2] - spaced[0], plain[2] - plain[0] + 20, 'the preview gets the spaced picture, not the cached plain one')
        self.assertEqual(self.picture(design='formal')[0], 0, 'a formal bar, not the cached plain picture')


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class RecordedDate(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.folder)

    def clip(self, name: str, *metadata: str) -> Path:
        path = self.folder / name
        tags = [arg for pair in metadata for arg in ('-metadata', pair)]
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x36:d=0.2', *tags, '-movflags', 'use_metadata_tags', str(path)], check=True)
        return path

    def test_a_camera_local_date_is_used_as_written(self):
        path = self.clip('phone.mov', 'com.apple.quicktime.creationdate=2026-01-15T17:42:10+0530', 'creation_time=2026-01-15T12:12:10Z')
        self.assertEqual(recorded_at(path), '2026-01-15T17:42')

    def test_a_utc_creation_time_becomes_this_macs_time(self):
        from datetime import datetime, timezone
        path = self.clip('camera.mp4', 'creation_time=2026-03-12T06:30:00Z')
        want = datetime(2026, 3, 12, 6, 30, tzinfo=timezone.utc).astimezone().strftime('%Y-%m-%dT%H:%M')
        self.assertEqual(recorded_at(path), want)

    def test_no_date_and_a_photos_exif_date(self):
        self.assertIsNone(recorded_at(self.clip('plain.mp4')))
        photo = self.folder / 'photo.jpg'
        exif = Image.Exif()
        exif[306] = '2025:12:25 08:05:00'
        Image.new('RGB', (8, 8)).save(photo, exif=exif)
        self.assertEqual(recorded_at(photo), '2025-12-25T08:05')


if __name__ == '__main__':
    unittest.main()


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class DrawnDesigns(unittest.TestCase):
    def words(self, **look):
        return box_of(design_picture(title(design=None, **look), FORMAT))

    def test_a_cloud_sits_behind_the_words_with_bumps_along_its_top(self):
        picture = design_picture(title(design='clouds', position='bottom', color='#1f3a5f'), FORMAT)
        cloud = picture[..., 3] > 0.9
        box = box_of(picture)
        words = self.words(position='bottom', color='#1f3a5f')
        self.assertLess(box[0], words[0]); self.assertGreater(box[2], words[2]); self.assertLess(box[1], words[1])
        tops = [np.nonzero(cloud[:, x])[0].min() for x in range(box[0] + 30, box[2] - 30, 4) if cloud[:, x].any()]
        self.assertGreater(np.ptp(tops), 3, 'a bumpy top, not a straight bar')

    def test_paper_is_torn_at_both_ends(self):
        picture = design_picture(title(design='paper', position='bottom', color='#2b2b2b'), FORMAT)
        paper = picture[..., 3] > 0.5
        rows = [y for y in range(360) if paper[y].any()]
        lefts = [np.nonzero(paper[y])[0].min() for y in rows[3:-3]]
        self.assertGreater(np.ptp(lefts), 2, 'a ragged end')
        self.assertLess(float(picture[rows[len(rows) // 2], :, 3].min()), 0.01, 'a strip, not the whole width')

    def test_a_torn_band_crosses_the_frame_under_a_ragged_pale_edge(self):
        picture = design_picture(title(design='torn', position='bottom'), FORMAT)
        band = picture[..., 3] > 0.9
        self.assertTrue(band[-2].all(), 'down to the bottom, right across')
        tops = [np.nonzero(band[:, x])[0].min() for x in range(0, 640, 5)]
        self.assertGreater(np.ptp(tops), 3)
        pale = (picture[..., :3].min(axis=2) > 0.85) & band
        self.assertGreater(pale.sum(), 200, 'pale paper fibres along the tear')

    def test_flourishes_reach_out_either_side_of_the_words(self):
        picture = design_picture(title(design='organic', subtitle_color='#ff0000', color='#ffffff', subtitle=None), FORMAT)
        red = (picture[..., 0] > 0.9) & (picture[..., 1] < 0.2) & (picture[..., 3] > 0.5)
        words = self.words(color='#ffffff', subtitle=None)
        cols = np.nonzero(red.any(axis=0))[0]
        self.assertLess(cols.min(), words[0]); self.assertGreater(cols.max(), words[2])

    def test_the_same_title_always_gets_the_same_picture(self):
        for design in ('clouds', 'paper', 'torn', 'organic'):
            self.assertTrue(np.array_equal(design_picture(title(design=design), FORMAT), design_picture(title(design=design), FORMAT)), design)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class CloudsWhole(unittest.TestCase):
    def test_no_gap_shows_through_the_cloud(self):
        for text in ('Pongal at the hill', 'Hi', 'A much longer title for a cloud'):
            picture = design_picture(title(design='clouds', text=text, position='bottom', subtitle='மலையில் பொங்கல்'), FORMAT)
            cloud = picture[..., 3] > 0.9
            box = box_of(picture)
            inner = cloud[box[1] + round(0.3 * (box[3] - box[1])):box[3] - 6, box[0] + 30:box[2] - 30]  # Inside its soft edge.
            self.assertTrue(inner.all(), f'{text}: solid inside')
