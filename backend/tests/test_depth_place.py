"""Place in depth: the clip's nearness, every frame (the model on every third, blended between), and masks of what is
nearer than a level, which the cut-out layer in front of a title uses like any person or land mask."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import depth_mask_service as depth, instance_service
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import CutoutPick


def fake_model(rgb: np.ndarray) -> np.ndarray:
    """Near is the red channel: the test clip paints a near box red over a far blue background."""
    return rgb[..., 0].astype(np.float32)


class Picks(unittest.TestCase):
    def test_depth_pick_has_a_level_and_no_numbers(self):
        self.assertEqual(instance_service.from_choice(CutoutPick(kind='depth', near=0.6)).token, 'depth-60')
        self.assertEqual(instance_service.parse('depth-15').near, 0.15)
        self.assertIsNone(instance_service.parse('depth-0'))
        with self.assertRaises(ValueError):
            CutoutPick(kind='depth')
        with self.assertRaises(ValueError):
            CutoutPick(kind='people', near=0.5)

    def test_a_depth_cut_out_stays_on_the_gpu(self):
        from app.services import gpu_render
        from app.services.timeline_schema import Timeline
        timeline = Timeline.model_validate({'format': {'width': 640, 'height': 360, 'fps': 30}, 'layers': [
            {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2}]},
            {'id': 't', 'kind': 'text', 'items': [{'id': 'x', 'start': 0, 'length': 2, 'text': 'KANAA', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 80}]},
            {'id': 'd', 'kind': 'video', 'name': 'Depth', 'items': [{'id': 'b', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2, 'muted': True, 'cutout': 'remove', 'cutout_pick': {'kind': 'depth', 'near': 0.6}}]}]})
        facts = MediaFacts(path=Path('v.mp4'), media_type='video', width=640, height=360, duration=2, fps=30)
        self.assertEqual(gpu_render.unsupported(timeline, lambda _: facts), [])

    def test_stream_reads_every_third_frame_and_blends(self):
        calls = []
        stream = depth.DepthStream(lambda rgb: calls.append(1) or rgb[..., 0].astype(np.float32))
        out = []
        for k in range(10):
            frame = np.zeros((40, 64, 3), np.uint8); frame[..., 2] = k * 20; frame[0, 0, 2] = 255  # BGR: red rises.
            out += stream.push(frame)
        out += stream.finish()
        self.assertEqual(len(out), 10)
        self.assertEqual(len(calls), 1 + 9 // depth.EVERY)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Masks(unittest.TestCase):
    def test_what_is_nearer_than_the_level_is_in_the_mask(self):
        root = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, root)
        clip = root / 'clip.mp4'
        # Far blue background; a near red box on the left; a middle-distance purple box on the right.
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x000040:s=320x180:d=1:r=30', '-vf',
                        'drawbox=x=20:y=40:w=80:h=100:color=0xff0000:t=fill,drawbox=x=200:y=40:w=80:h=100:color=0x800080:t=fill', '-pix_fmt', 'yuv420p', str(clip)], check=True)
        facts = MediaFacts(path=clip, media_type='video', width=320, height=180, duration=1, fps=30)
        with mock.patch('app.services.asset_service.settings.data_dir', root), mock.patch.object(depth, '_raw', fake_model):
            depth.make_depth_map(facts, lambda _: None, lambda: False, model=fake_model)
            near_only, mid_too = root / 'near.mp4', root / 'mid.mp4'
            depth.make_depth_mask(facts, 0.75, near_only, lambda _: None, lambda: False)
            depth.make_depth_mask(facts, 0.3, mid_too, lambda _: None, lambda: False)
        read = lambda path: np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', 'format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'],
                                                        capture_output=True, check=True).stdout, np.uint8)
        a, b = read(near_only), read(mid_too)
        size = int(np.sqrt(a.size * 180 / 320)); h, w = size, a.size // size
        a, b = a.reshape(h, w), b.reshape(h, w)
        at = lambda img, x, y: img[int(y * h), int(x * w)]
        self.assertGreater(at(a, 60 / 320, 0.5), 200)   # The near box is in front at both levels.
        self.assertLess(at(a, 240 / 320, 0.5), 60)      # The middle box only when the title sits further back.
        self.assertGreater(at(b, 240 / 320, 0.5), 200)
        self.assertLess(at(b, 160 / 320, 0.1), 60)      # The far background never.


if __name__ == '__main__':
    unittest.main()


class Skyline(unittest.TestCase):
    @unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
    def test_finds_where_land_meets_sky(self):
        root = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, root)
        clip = root / 'clip.mp4'
        # Sky (far, blue) above a ridge at 40% down (near, red).
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x000040:s=320x180:d=1:r=30', '-vf', 'drawbox=x=0:y=72:w=320:h=108:color=0xff0000:t=fill',
                        '-pix_fmt', 'yuv420p', str(clip)], check=True)
        facts = MediaFacts(path=clip, media_type='video', width=320, height=180, duration=1, fps=30)
        with mock.patch('app.services.asset_service.settings.data_dir', root):
            depth.make_depth_map(facts, lambda _: None, lambda: False, model=fake_model)
            found = depth.skyline(facts, [0.2, 0.6], 0.1, 0.9)
        for value in found:
            self.assertAlmostEqual(value, 0.4, delta=0.04)


class NearnessAtSpot(unittest.TestCase):
    def test_reads_the_middle_of_a_patch_of_the_depth_map(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'map.mp4'  # Left half far (dark), right half near (bright).
            subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x202020:s=320x180:d=1', '-f', 'lavfi', '-i', 'color=c=0xe0e0e0:s=160x180:d=1',
                            '-filter_complex', '[0][1]overlay=160:0', '-pix_fmt', 'yuv420p', str(source)], check=True)
            facts = MediaFacts(path=Path(folder) / 'clip.mp4', media_type='video', width=320, height=180, duration=1, fps=30)
            with mock.patch.object(depth, 'map_path', return_value=source):
                self.assertLess(depth.nearness_at(facts, 0.2, 0.2, 0.5), 0.2)
                self.assertGreater(depth.nearness_at(facts, 0.2, 0.8, 0.5), 0.8)
                with self.assertRaises(ValueError):
                    depth.nearness_at(facts, 30, 0.5, 0.5)
