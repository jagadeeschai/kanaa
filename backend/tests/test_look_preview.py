"""The Cinematic tab's still preview: one frame before and after the chosen looks, in the stack's order, through each
look's own per-frame code; looks about movement are listed as not shown in a still."""
import base64
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import look_preview_service as preview
from app.services.media_probe import MediaFacts


def decode(data_url: str) -> np.ndarray:
    import cv2
    return cv2.imdecode(np.frombuffer(base64.b64decode(data_url.split(',', 1)[1]), np.uint8), cv2.IMREAD_COLOR).astype(float)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Preview(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.root)
        self.clip, self.depth = self.root / 'clip.mp4', self.root / 'depth.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=2:r=30', '-pix_fmt', 'yuv420p', str(self.clip)], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=2:r=30', '-vf', 'drawbox=x=0:y=160:w=640:h=200:color=0x707070:t=fill',
                        '-pix_fmt', 'yuv420p', str(self.depth)], check=True)
        self.facts = MediaFacts(path=self.clip, media_type='video', width=640, height=360, duration=2, fps=30)

    def run_preview(self, looks):
        with mock.patch.object(preview, 'make_depth_map', return_value=self.depth) as depth:
            found = preview.render(self.facts, 0, 2, 1.0, looks, lambda _: self.facts)
        return found, depth

    def test_night_is_darker_and_moving_looks_are_listed(self):
        found, _ = self.run_preview([{'kind': 'blur', 'preset': 'natural'}, {'kind': 'night', 'mood': 'dark'}])
        before, after = decode(found['before']), decode(found['after'])
        self.assertEqual(before.shape, after.shape)
        self.assertLess(after.mean(), before.mean() * 0.6)
        self.assertEqual(found['not_shown'], ['blur'])

    def test_no_looks_is_the_original_and_needs_no_depth(self):
        found, depth = self.run_preview([])
        self.assertLess(np.abs(decode(found['before']) - decode(found['after'])).mean(), 1)
        depth.assert_not_called()  # Nothing that needs depth: none worked out.

    def test_every_still_look_renders_in_order(self):
        looks = [{'kind': 'lens', 'preset': 'portrait', 'strength': 'strong'}, {'kind': 'new_sky', 'sky': 'sunset'}, {'kind': 'rays', 'preset': 'soft'},
                 {'kind': 'atmosphere', 'preset': 'mist', 'strength': 'medium', 'tune': {'density': 9}}, {'kind': 'match', 'reference': {'media': 1, 'start': 0, 'end': 2}}]
        found, _ = self.run_preview(looks)
        after = decode(found['after'])
        self.assertGreater(np.abs(after - decode(found['before'])).mean(), 5)  # Something visibly changed.
        self.assertEqual(found['not_shown'], [])


if __name__ == '__main__':
    unittest.main()
