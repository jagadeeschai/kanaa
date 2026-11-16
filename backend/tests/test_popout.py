"""Pop-out (3D): two pictures, a cut-out with a soft alpha and a filled background, and where the person stands."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

from app.services import local_fill, popout, remove_person
from tests.test_remove_person import FAKE_FINDER


class Popout(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.picture = self.root / 'scene.png'
        Image.fromarray(np.random.default_rng(2).integers(0, 255, (400, 600, 3), np.uint8)).save(self.picture)
        (self.root / 'finder.py').write_text(FAKE_FINDER)
        self.row = {'id': 4, 'filename': 'AI scene 8.png', 'absolute_path': str(self.picture), 'media_type': 'image', 'folder': 'Song'}
        self.jobs = []
        for patch in [mock.patch.object(remove_person, 'get_media', return_value=self.row), mock.patch.object(popout, 'get_media', return_value=self.row),
                      mock.patch.object(remove_person.settings, 'data_dir', self.root), mock.patch.object(popout.settings, 'data_dir', self.root),
                      mock.patch.object(popout, 'update_job'), mock.patch.object(local_fill, 'available', return_value=True),
                      mock.patch.object(popout, 'enqueue_render', side_effect=lambda kind, label, run, **_: self.jobs.append(run) or 'job-1')]:
            patch.start(); self.addCleanup(patch.stop)
        remove_person.find_people(4, [sys.executable, str(self.root / 'finder.py')])

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_makes_a_cut_out_and_a_filled_background(self):
        class Green:
            def run(self, _, inputs):
                return [np.full((1, 3, 512, 512), [[[0.]], [[200.]], [[0.]]], np.float32)]
        saved = []
        with mock.patch.object(local_fill, '_model', return_value=Green()), \
             mock.patch.object(popout, 'index_media', side_effect=lambda path, name, folder=None: saved.append((Path(path), name)) or {'id': 20 + len(saved)}):
            popout.start(4, [1])
            result = self.jobs[0](lambda: False)
        self.assertEqual((result['background_id'], result['person_id']), (21, 22))
        where = result['where']
        self.assertTrue(0.1 <= where['x'] <= 0.3 and where['top'] == 0.25 and where['bottom'] == 0.75, where)
        background = np.asarray(Image.open(saved[0][0]))
        person = np.asarray(Image.open(saved[1][0]))
        original = np.asarray(Image.open(self.picture))
        self.assertEqual(background[200, 90].tolist(), [0, 200, 0])  # Filled where person 1 stood.
        self.assertTrue((background[:, 400:] == original[:, 400:]).all())
        self.assertEqual(person.shape[2], 4)
        self.assertEqual(person[200, 90, 3], 255)  # The person, opaque...
        self.assertEqual(person[200, 500, 3], 0)  # ...and everything else see-through.
        self.assertTrue((person[200, 90, :3] == original[200, 90]).all())  # The person's own pixels.
        self.assertEqual([name for _, name in saved], ['AI scene 8 (background).png', 'AI scene 8 (cut-out).png'])

    def test_needs_a_choice_and_the_fill_model(self):
        with self.assertRaises(ValueError):
            popout.start(4, [])
        with mock.patch.object(local_fill, 'available', return_value=False), self.assertRaises(ValueError):
            popout.start(4, [1])


if __name__ == '__main__':
    unittest.main()
