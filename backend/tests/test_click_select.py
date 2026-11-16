"""Click to choose: clicks become one outline that Remove takes like a found person; the real model outlines a shape."""
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image, ImageDraw

from app.services import click_select, remove_person


class Clicks(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.picture = self.root / 'scene.png'
        image = Image.new('RGB', (1200, 800), (90, 150, 220))
        ImageDraw.Draw(image).ellipse((500, 300, 700, 500), fill=(200, 40, 40))  # A red ball in a blue sky.
        image.save(self.picture)
        self.row = {'id': 3, 'filename': 'sky.png', 'absolute_path': str(self.picture), 'media_type': 'image', 'folder': None}
        click_select._read.clear()
        for patch in [mock.patch.object(click_select, 'get_media', return_value=self.row), mock.patch.object(remove_person, 'get_media', return_value=self.row),
                      mock.patch.object(remove_person.settings, 'data_dir', self.root)]:
            patch.start(); self.addCleanup(patch.stop)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_clicks_are_sent_in_the_models_pixels_and_saved_as_removes_choice(self):
        sent = {}
        encoder = mock.Mock(return_value=np.zeros((1, 256, 64, 64), np.float32))

        def decoder(feed):
            sent.update(feed)
            out = np.full((1, 1, int(feed['orig_im_size'][0]), int(feed['orig_im_size'][1])), -1.0, np.float32)
            out[0, 0, 200:300, 400:500] = 1
            return out
        found = click_select.outline(3, [{'x': 0.5, 'y': 0.5, 'keep': True}, {'x': 0.1, 'y': 0.1, 'keep': False}], encoder, decoder)
        click_select.outline(3, [{'x': 0.5, 'y': 0.5}], encoder, decoder)
        self.assertEqual(encoder.call_count, 1)  # The picture is read once, then every click is quick.
        self.assertEqual(sent['orig_im_size'].tolist(), [683, 1024])  # Read at 1024 wide.
        self.assertEqual(sent['point_coords'][0, 0].tolist(), [512, 341.5])
        self.assertAlmostEqual(found['area'], 100 * 100 / (1024 * 683), places=3)
        self.assertTrue((remove_person._folder(self.picture, 'clicks') / 'person-1.png').exists())
        mask = remove_person.chosen_mask(self.picture, [1], (1200, 800), 'clicks')
        self.assertEqual(mask.size, (1200, 800))
        self.assertEqual(np.asarray(mask)[293, 527], 255)  # The clicked area, scaled back to the picture.

    def test_takes_away_and_refuses(self):
        with self.assertRaises(ValueError):
            click_select.outline(3, [])
        with self.assertRaises(ValueError):
            remove_person.find_people(3, ['true'], kind='clicks')  # An outline is clicked, not looked for.

    @unittest.skipUnless(click_select.available(), 'needs MobileSAM in backend/.models/mobilesam')
    def test_the_real_model_outlines_the_clicked_ball(self):
        found = click_select.outline(3, [{'x': 0.5, 'y': 0.5}])
        mask = np.asarray(Image.open(remove_person._folder(self.picture, 'clicks') / 'person-1.png')) > 127
        ball = np.zeros(mask.shape, bool)
        h, w = mask.shape
        yy, xx = np.ogrid[:h, :w]
        ball[((xx - w * 600 / 1200) / (w * 100 / 1200)) ** 2 + ((yy - h * 400 / 800) / (h * 100 / 800)) ** 2 <= 1] = True
        self.assertGreater((mask & ball).sum() / (mask | ball).sum(), 0.85, found)


if __name__ == '__main__':
    unittest.main()
