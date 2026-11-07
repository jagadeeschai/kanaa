"""Where people are, as the coarse grid a title keeps clear of (keepClear.ts reads it)."""
import base64
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import people_grid_service


def unpack(packed: str, w: int, h: int) -> np.ndarray:
    return np.unpackbits(np.frombuffer(base64.b64decode(packed), np.uint8))[:w * h].reshape(h, w).astype(bool)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class PeopleGrid(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)
        # A mask whose white "person" is the left quarter for the first second, then the right quarter.
        self.mask = self.folder / 'person-mask-3.mp4'
        graph = "color=black:s=320x180:r=30:d=2,format=gray,drawbox=x=0:y=0:w=80:h=180:color=white:t=fill:enable='lt(t,1)',drawbox=x=240:y=0:w=80:h=180:color=white:t=fill:enable='gte(t,1)'"
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'lavfi', '-i', graph, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(self.mask)], check=True)

    def test_cells_follow_the_mask_over_time(self):
        grid = people_grid_service.people_grid(self.mask, 0, 1.9)
        self.assertEqual((grid['w'], grid['h']), (people_grid_service.GRID_W, people_grid_service.GRID_H))
        self.assertAlmostEqual(grid['fps'], people_grid_service.SAMPLES_PER_SECOND, delta=1)
        self.assertGreaterEqual(len(grid['frames']), 20)
        early, late = unpack(grid['frames'][2], grid['w'], grid['h']), unpack(grid['frames'][-2], grid['w'], grid['h'])
        quarter = grid['w'] // 4
        self.assertTrue(early[:, :quarter - 2].all() and not early[:, quarter + 2:].any())
        self.assertTrue(late[:, -quarter + 2:].all() and not late[:, :-quarter - 2].any())

    def test_made_once_and_kept(self):
        with mock.patch.object(people_grid_service, 'folder_for', return_value=self.folder):
            first = people_grid_service.ensure(self.mask, self.mask, 0, 1)
            with mock.patch.object(people_grid_service, 'people_grid', side_effect=AssertionError('made again')):
                self.assertEqual(people_grid_service.ensure(self.mask, self.mask, 0, 1), first)
            self.assertNotEqual(people_grid_service.grid_path(self.mask, self.mask, 0, 1), people_grid_service.grid_path(self.mask, self.mask, 0, 1.5))


if __name__ == '__main__':
    unittest.main()
