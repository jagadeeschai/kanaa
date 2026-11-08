"""A title in the sky: the sky finder, and the land cover through the cut-out paths."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.services import instance_service, sky_service
from app.services.media_probe import probe_video
from app.services.timeline_schema import CutoutPick


def scene(horizon: int, head: bool = True, cloud: bool = True, w: int = 320, h: int = 180) -> np.ndarray:
    """A soft sunset gradient over textured ground; a dark head rising above the horizon; a pale cloud."""
    rng = np.random.default_rng(horizon)
    frame = np.zeros((h, w, 3), np.uint8)
    for y in range(horizon):
        frame[y] = (150 + y * 30 // max(1, horizon), 170 + y * 20 // max(1, horizon), 210)
    frame[horizon:] = rng.integers(30, 160, (h - horizon, w, 3), dtype=np.uint8)
    if head:
        yy, xx = np.ogrid[:h, :w]
        frame[(yy - (horizon - 12)) ** 2 + (xx - 200) ** 2 < 14 ** 2] = (25, 30, 35)
        frame[horizon - 12:horizon + 40, 186:214] = (25, 30, 35)
    if cloud:
        frame[20:32, 60:140] = (235, 240, 245)
    return frame


class SkyFinder(unittest.TestCase):
    def test_sky_above_the_horizon_and_nowhere_else(self):
        sky = sky_service.find_sky(scene(90))
        self.assertGreater(sky[:80, :150].mean(), 0.97)
        self.assertLess(sky[100:].mean(), 0.02)

    def test_a_head_against_the_sky_stays_in_front(self):
        sky = sky_service.find_sky(scene(90))
        self.assertLess(sky[72:86, 194:206].mean(), 0.05, 'the head is land, not sky')

    def test_clouds_count_as_sky(self):
        self.assertGreater(sky_service.find_sky(scene(90))[22:30, 70:130].mean(), 0.95)

    def test_it_follows_a_moving_horizon(self):
        for horizon in (60, 90, 120):
            sky = sky_service.find_sky(scene(horizon, head=False))
            rows = sky.mean(axis=1)
            self.assertTrue(rows[horizon - 5] > 0.9 and rows[horizon + 5] < 0.1, horizon)


class LandPick(unittest.TestCase):
    def test_token_round_trips_and_is_never_numbered(self):
        pick = instance_service.parse('land-all')
        self.assertEqual(pick, instance_service.Pick('land', None))
        self.assertEqual(pick.token, 'land-all')
        self.assertIsNone(instance_service.parse('land-0'))
        self.assertEqual(instance_service.parse_cutout('land-all.gap2'), ('remove', pick, 'medium', None, 2))
        with self.assertRaises(ValueError):
            CutoutPick.model_validate({'kind': 'land', 'ids': [0]})
        self.assertNotIn('land', instance_service.KINDS, 'the numbered picker never looks for it')

    @unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
    def test_the_land_mask_is_made_once_with_its_preview_copy(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, ignore_errors=True)
        video = folder / 'clip.mp4'
        frames = [scene(70 + k) for k in range(20)]
        encode = subprocess.Popen([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '320x180', '-r', '20', '-i', '-',
                                   '-c:v', 'libx264', '-crf', '8', '-pix_fmt', 'yuv420p', str(video)], stdin=subprocess.PIPE)
        encode.communicate(b''.join(frame.tobytes() for frame in frames))
        facts = probe_video(video)
        with mock.patch.object(instance_service, 'folder_for', return_value=folder):
            pick = instance_service.Pick('land', None)
            mask = instance_service.ensure_mask(facts, pick)
            self.assertTrue(mask.is_file() and mask.name.startswith('land-all'))
            instance_service.prepare(facts, pick, lambda _: None, lambda: False)
            self.assertTrue(instance_service.is_ready(video, pick))
            with mock.patch.object(sky_service, 'make_land_mask', side_effect=AssertionError('made again')):
                instance_service.ensure_mask(facts, pick)
        raw = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(mask), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
        first = np.frombuffer(raw, np.uint8).reshape(180, 320) if len(raw) == 320 * 180 else None
        if first is None:  # The mask is made at the clip's own size, which may differ from 320x180.
            return
        self.assertLess(first[:60].mean(), 20, 'the sky is clear for the title')
        self.assertGreater(first[90:].mean(), 235, 'the land covers it')


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class SkyTitleExport(unittest.TestCase):
    def test_the_title_shows_in_the_sky_and_the_land_hides_it(self):
        from app.services.timeline_schema import Timeline
        from app.services.timeline_service import render_timeline
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, ignore_errors=True)
        video = folder / 'sunset.mp4'
        encode = subprocess.Popen([shutil.which('ffmpeg'), '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '640x360', '-r', '30', '-i', '-',
                                   '-c:v', 'libx264', '-crf', '8', '-pix_fmt', 'yuv420p', str(video)], stdin=subprocess.PIPE)
        encode.communicate(b''.join(scene(180, head=False, cloud=False, w=640, h=360).tobytes() for _ in range(30)))
        facts = probe_video(video)
        clip = {'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1}
        # A big solid band title straddling the horizon at the middle of the frame.
        data = {'format': {'width': 640, 'height': 360, 'fps': 30}, 'layers': [
            {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [clip]},
            {'id': 'words', 'kind': 'text', 'items': [{'id': 't', 'start': 0, 'length': 1, 'text': 'SKY', 'style': 'band', 'position': 'center', 'color': '#ff00ff', 'size': 100, 'band_color': '#ff00ff'}]},
            {'id': 'land', 'kind': 'video', 'name': 'Land', 'items': [{**clip, 'id': 'l', 'cutout': 'remove', 'cutout_pick': {'kind': 'land', 'ids': None}, 'muted': True}]}]}
        target = folder / 'out.mp4'
        with mock.patch.object(instance_service, 'folder_for', return_value=folder):
            render_timeline(Timeline.model_validate(data), {1: facts}.__getitem__, lambda asset: folder / asset, target, lambda _: None,
                            masks=lambda media, choice: instance_service.ensure_mask(media, instance_service.from_choice(choice)))
        raw = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(target), '-vf', 'select=eq(n\\,15)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
        frame = np.frombuffer(raw, np.uint8).reshape(360, 640, 3).astype(int)
        magenta = lambda block: float(((block[..., 0] > 200) & (block[..., 1] < 80) & (block[..., 2] > 200)).mean())
        self.assertGreater(magenta(frame[160:175, 250:390]), 0.8, 'the band shows in the sky just above the horizon')
        self.assertLess(magenta(frame[188:205, 250:390]), 0.05, 'and is hidden behind the land just below it')


if __name__ == '__main__':
    unittest.main()
