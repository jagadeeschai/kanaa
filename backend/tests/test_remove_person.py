"""Remove person: people found in a picture, the chosen ones' place filled by the provider, every other pixel kept.
The finder and the provider are faked: no Vision run, no network."""
import asyncio
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

from app.services import remove_person

FAKE_FINDER = '''
import sys
w, h = int(sys.argv[1]), int(sys.argv[2]); sys.stdin.buffer.read(w * h * 3)
masks = []
for left in (w * 6 // 10, w // 10):  # Two people, the right one first: they are numbered left to right.
    m = bytearray(w * h)
    for y in range(h // 4, h * 3 // 4):
        for x in range(left, left + w // 6): m[y * w + x] = 255
    masks.append(bytes(m))
sys.stdout.buffer.write(bytes([len(masks)]) + b''.join(masks))
'''


class RemovePerson(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.picture = self.root / 'scene.png'
        rng = np.random.default_rng(1)
        Image.fromarray(rng.integers(0, 255, (400, 600, 3), np.uint8)).save(self.picture)
        (self.root / 'finder.py').write_text(FAKE_FINDER)
        self.finder = [sys.executable, str(self.root / 'finder.py')]
        self.row = {'id': 4, 'filename': 'AI scene 8.png', 'absolute_path': str(self.picture), 'media_type': 'image', 'folder': 'Song'}
        self.jobs = []
        for patch in [mock.patch.object(remove_person, 'get_media', return_value=self.row), mock.patch.object(remove_person.settings, 'data_dir', self.root),
                      mock.patch.object(remove_person, 'update_job'), mock.patch.object(remove_person, 'read_settings', return_value={'api_key': 'k', 'base_url': 'https://x.example/v1', 'model': 'm'}),
                      mock.patch.object(remove_person, 'enqueue_render', side_effect=lambda kind, label, run, **_: self.jobs.append(run) or 'job-1')]:
            patch.start(); self.addCleanup(patch.stop)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_finds_people_numbered_left_to_right_with_a_preview(self):
        found = remove_person.find_people(4, self.finder)
        self.assertEqual(found['count'], 2)
        folder = remove_person._folder(self.picture)
        left = np.asarray(Image.open(folder / 'person-1.png')) > 127
        self.assertLess(np.nonzero(left)[1].mean(), 300)  # Person 1 is the one on the left.
        self.assertTrue((folder / 'preview.jpg').exists())

    def test_fills_only_the_chosen_person_and_keeps_every_other_pixel(self):
        remove_person.find_people(4, self.finder)
        sent = {}

        async def provider(config, picture, mask, size, quality, should_cancel):
            sent.update(size=size, holed=Image.open(io.BytesIO(mask)))
            buffer = io.BytesIO(); Image.new('RGB', (1536, 1024), (0, 200, 0)).save(buffer, 'PNG'); return buffer.getvalue()
        with mock.patch.object(remove_person, 'request_fill', provider), mock.patch.object(remove_person, 'index_media', return_value={'id': 9}) as index:
            remove_person.start_remove(4, [1])
            self.assertEqual(self.jobs[0](lambda: False), {'progress': 100, 'media_id': 9})
        self.assertEqual(sent['size'], '1536x1024')
        alpha = np.asarray(sent['holed'].split()[-1])
        self.assertEqual(alpha[512, 1536 * 15 // 100], 0)  # Person 1's place is transparent: paint here.
        self.assertEqual(alpha[512, 1536 * 65 // 100], 255)  # Person 2 was not chosen: kept.
        result = np.asarray(Image.open(index.call_args.args[0])).astype(int)
        original = np.asarray(Image.open(self.picture)).astype(int)
        self.assertEqual(result[200, 90].tolist(), [0, 200, 0])  # Filled where person 1 stood.
        self.assertTrue((result[:, 400:] == original[:, 400:]).all())  # Everything else exactly as it was.
        self.assertEqual(index.call_args.args[1], 'AI scene 8 (person removed).png')

    def test_refuses_nothing_chosen_unknown_people_videos_and_no_key(self):
        remove_person.find_people(4, self.finder)
        for numbers in ([], [5]):
            with self.assertRaises(ValueError):
                remove_person.start_remove(4, numbers)
        with mock.patch.object(remove_person, 'read_settings', return_value={'api_key': ''}), self.assertRaises(ValueError):
            remove_person.start_remove(4, [1])
        self.row['media_type'] = 'video'
        with self.assertRaises(ValueError):
            remove_person.find_people(4, self.finder)


if __name__ == '__main__':
    unittest.main()
