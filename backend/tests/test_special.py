"""Face-aimed moves, scene changes and special effects."""
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import settings
from app.main import app
from app.services import effect_service, focus_service, scene_service
from app.services.media_probe import probe_video


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True, capture_output=True)


class Focus(unittest.TestCase):
    def test_the_main_faces_decide_the_point(self):
        self.assertIsNone(focus_service.focus_point([]))
        # Two people of the same size: halfway between them.
        self.assertEqual(focus_service.focus_point([((0.2, 0.4, 0.1, 0.1), 1.0), ((0.6, 0.4, 0.1, 0.1), 1.0)]), (0.4, 0.4))
        # A tiny face in the background is left out.
        self.assertEqual(focus_service.focus_point([((0.7, 0.3, 0.2, 0.2), 1.0), ((0.05, 0.9, 0.02, 0.02), 1.0)]), (0.7, 0.3))

    def test_a_photo_is_searched_at_a_working_size(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'photo.png'
            Image.new('RGB', (1200, 800), (90, 120, 200)).save(path)
            seen = []

            def factory(size):
                seen.append(size)
                return lambda picture: [((0.75, 0.25, 0.1, 0.15), 0.9)] if picture.shape[:2] == (size[1], size[0]) else []
            result = focus_service.find_focus(path, 'image', 1200, 800, detector_factory=factory)
        self.assertEqual(seen, [(640, 426)])
        self.assertEqual(result, {'x': 0.75, 'y': 0.25, 'faces': 1})

    def test_a_video_frame_can_be_searched(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'clip.mp4'
            ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path))
            means = []
            focus_service.find_focus(path, 'video', 320, 180, at=1.0, detector_factory=lambda size: lambda picture: means.append(picture[..., 2].mean()) or [])
        self.assertGreater(means[0], 200, 'BGR: red is the last channel')


class Scenes(unittest.TestCase):
    def test_jumps_well_above_the_usual_change_are_cuts(self):
        steady = [0.0] + [0.02] * 59
        changes = steady + [0.8] + [0.02] * 59 + [0.5] + [0.02] * 59
        self.assertEqual(scene_service.cuts_from_changes(changes, 30), [2.0, 4.0])
        # A fast pan changes a lot every frame; one more big frame in it is not a cut.
        panning = [0.0] + [0.4] * 100
        panning[50] = 0.6
        self.assertEqual(scene_service.cuts_from_changes(panning, 30), [])
        # Two cuts under a second apart keep only the first, and nothing in the last second.
        close = [0.0] + [0.01] * 59 + [0.9] + [0.01] * 10 + [0.9] + [0.01] * 20
        self.assertEqual(scene_service.cuts_from_changes(close, 30), [2.0])

    def test_finds_the_cuts_in_a_joined_video(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'joined.mp4'
            ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=192x108:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=navy:s=192x108:r=30:d=2', '-f', 'lavfi', '-i', 'testsrc=s=192x108:r=30:d=2',
                   '-filter_complex', '[0][1][2]concat=n=3:v=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path))
            progress = []
            result = scene_service.find_scenes(path, 0, 6, progress.append, lambda: False)
        self.assertEqual(len(result['cuts']), 2, result)
        for found, expected in zip(result['cuts'], (2.0, 4.0)):
            self.assertAlmostEqual(found, expected, delta=0.1)
        self.assertTrue(progress)


class Effects(unittest.TestCase):
    def test_every_effect_draws_light_on_black(self):
        size = (90, 160)
        for effect in effect_service.EFFECTS:
            paint = effect_service.EFFECT_PAINTERS[effect.id]
            rng = np.random.default_rng(1)
            frames = [np.asarray(paint(n, 150, size, rng).convert('RGB')) for n in (30, 75)]
            for frame in frames:
                self.assertEqual(frame.shape, (160, 90, 3), effect.id)
            self.assertGreater(max(frame.max() for frame in frames), 60, f'{effect.id} shows some light')
            self.assertLess(np.median(frames[0]), 200, f'{effect.id} keeps black (or soft light) around it')

    def test_an_effect_is_a_video_the_shape_of_the_project(self):
        self.assertEqual(effect_service.work_size(1080, 1920), (720, 1280))
        self.assertEqual(effect_service.work_size(3840, 2160), (1280, 720))
        with tempfile.TemporaryDirectory() as folder, patch.object(effect_service, 'SECONDS', 0.5):
            target = effect_service.render_effect('confetti', (128, 72), Path(folder) / 'confetti.mp4')
            facts = probe_video(target)
        self.assertEqual((facts.width, facts.height), (128, 72))
        self.assertAlmostEqual(facts.duration, 0.5, delta=0.1)


class Api(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.patches = [patch.object(settings, key, self.root / value) for key, value in [('data_dir', 'data'), ('thumbnail_dir', 'thumbs'), ('edit_workspace_dir', 'exports'), ('model_cache_dir', 'models')]]
        self.patches.append(patch.object(effect_service, 'SECONDS', 0.4))
        for item in self.patches: item.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches): item.stop()
        self.folder.cleanup()

    def wait(self, job_id):
        for _ in range(300):
            status = self.client.get(f'/api/jobs/{job_id}/status').json()
            if status.get('status') in {'done', 'failed', 'cancelled'}:
                return status
            time.sleep(0.1)
        self.fail('The job did not finish')

    def test_effects_are_made_once_and_filed_together(self):
        listed = self.client.get('/api/effects').json()
        self.assertIn('petals', [effect['id'] for effect in listed])
        self.assertEqual(self.client.post('/api/effects/nothing', json={'width': 1080, 'height': 1920}).status_code, 404)
        self.assertEqual(self.client.post('/api/effects/petals', json={'width': 'wide'}).status_code, 400)
        first = self.client.post('/api/effects/petals', json={'width': 1080, 'height': 1920}).json()
        status = self.wait(first['job_id'])
        self.assertEqual(status['status'], 'done', status)
        again = self.client.post('/api/effects/petals', json={'width': 1080, 'height': 1920}).json()
        self.assertEqual(again['media']['id'], status['media_id'], 'the second use is instant')
        self.assertEqual(again['media']['folder'], 'Effects')
        self.assertEqual((again['media']['width'], again['media']['height']), (720, 1280))

    def test_focus_never_downloads_the_face_finder(self):
        stream = self.root / 'photo.png'
        Image.new('RGB', (300, 200), 'white').save(stream)
        media = self.client.post('/api/media', files={'file': ('photo.png', stream.read_bytes(), 'image/png')}).json()
        with patch('urllib.request.urlopen', side_effect=AssertionError('no downloads')):
            found = self.client.get(f"/api/photos/{media['id']}/focus").json()
        self.assertEqual(found, {'x': None, 'y': None, 'faces': 0, 'model': False})

    def test_scenes_are_found_as_a_job(self):
        video = self.root / 'clip.mp4'
        ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=192x108:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=navy:s=192x108:r=30:d=2', '-filter_complex', '[0][1]concat=n=2:v=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(video))
        media = self.client.post('/api/media', files={'file': ('clip.mp4', video.read_bytes(), 'video/mp4')}).json()
        self.assertEqual(self.client.post(f"/api/photos/{media['id']}/scenes", json={'start': 2, 'end': 1}).status_code, 400)
        job = self.client.post(f"/api/photos/{media['id']}/scenes", json={'start': 0, 'end': 4}).json()
        status = self.wait(job['job_id'])
        self.assertEqual(status['status'], 'done', status)
        self.assertEqual(len(status['cuts']), 1)
        self.assertAlmostEqual(status['cuts'][0], 2.0, delta=0.1)


if __name__ == '__main__':
    unittest.main()


class Reframe(unittest.TestCase):
    def test_follows_the_biggest_face_smoothly(self):
        from app.services.reframe_service import subject_path
        self.assertEqual(subject_path([], 0, 4), [])
        # A big face walks from the left to the right over 4 seconds; a small one stays put on the right.
        walker = [[t / 30, 0.2 + 0.6 * (t / 120), 0.4, 0.2, 0.3] for t in range(121)]
        bystander = [[t / 30, 0.9, 0.5, 0.05, 0.08] for t in range(121)]
        path = subject_path([bystander, walker], 0, 4)
        self.assertEqual([point[0] for point in path], [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
        xs = [point[1] for point in path]
        self.assertTrue(all(b >= a - 1e-6 for a, b in zip(xs, xs[1:])), xs)  # Moves one way only, no jitter.
        self.assertLess(xs[0], 0.35); self.assertGreater(xs[-1], 0.65)
        self.assertAlmostEqual(path[4][1], 0.5, delta=0.06)

    def test_holds_still_for_small_movements_and_fills_gaps(self):
        from app.services.reframe_service import subject_path
        nodding = [[t / 30, 0.5 + 0.02 * (t % 2), 0.5, 0.2, 0.3] for t in range(61)]
        self.assertEqual({point[1] for point in subject_path([nodding], 0, 2)}, {0.5})
        # Seen only in the second half: the first half holds where they will be.
        late = [[1 + t / 30, 0.7, 0.4, 0.2, 0.3] for t in range(31)]
        self.assertEqual({point[1] for point in subject_path([late], 0, 2)}, {0.7})


class Moments(unittest.TestCase):
    def test_the_sharp_steady_well_lit_stretch_wins(self):
        from app.services import moment_service
        rng = np.random.default_rng(3)
        detail = rng.integers(0, 255, (108, 192, 1)).repeat(3, axis=2).astype(np.uint8)
        dark = (detail // 8).astype(np.uint8)
        blurry = np.full((108, 192, 3), 128, np.uint8)
        # 2 s dark, 2 s sharp and bright, 2 s featureless.
        pictures = [dark] * 10 + [detail] * 10 + [blurry] * 10
        scores = moment_service.frame_scores(iter(pictures))
        self.assertEqual(moment_service.best_start(scores, 6, 2), 2.0)
        # All alike: the middle, as before.
        self.assertEqual(moment_service.best_start([1.0] * 30, 6, 2), 2.0)
        self.assertEqual(moment_service.best_start([1.0] * 30, 6, 8), 0.0)

    def test_faces_count_when_the_finder_is_there(self):
        from app.services import moment_service
        plain = np.full((108, 192, 3), 120, np.uint8)
        face_from = 20
        frames = iter([plain] * 30)
        seen = iter(range(30))
        scores = moment_service.frame_scores(frames, lambda picture: [((0.5, 0.5, 0.2, 0.3), 0.9)] if next(seen) >= face_from else [])
        self.assertEqual(moment_service.best_start(scores, 6, 2), 4.0)

    def test_a_real_video_is_searched_past_its_edges(self):
        from app.services import moment_service
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'clip.mp4'
            ffmpeg('-f', 'lavfi', '-i', 'color=c=black:s=192x108:r=30:d=3', '-f', 'lavfi', '-i', 'testsrc2=s=192x108:r=30:d=3',
                   '-filter_complex', '[0][1]concat=n=2:v=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path))
            start = moment_service.find_best(path, 6, 2)
        self.assertGreaterEqual(start, 3.0)
        self.assertLessEqual(start, 4.0)

    def test_the_api_picks_moments_as_a_job(self):
        api = Api('test_effects_are_made_once_and_filed_together')
        api.setUp()
        try:
            video = api.root / 'clip.mp4'
            ffmpeg('-f', 'lavfi', '-i', 'color=c=black:s=192x108:r=30:d=3', '-f', 'lavfi', '-i', 'testsrc2=s=192x108:r=30:d=3', '-filter_complex', '[0][1]concat=n=2:v=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(video))
            media = api.client.post('/api/media', files={'file': ('clip.mp4', video.read_bytes(), 'video/mp4')}).json()
            stream = api.root / 'photo.png'; Image.new('RGB', (100, 100), 'white').save(stream)
            photo = api.client.post('/api/media', files={'file': ('photo.png', stream.read_bytes(), 'image/png')}).json()
            self.assertEqual(api.client.post('/api/best-moments', json={'items': []}).status_code, 400)
            job = api.client.post('/api/best-moments', json={'items': [{'media_id': media['id'], 'length': 2}, {'media_id': photo['id'], 'length': 3}]}).json()
            status = api.wait(job['job_id'])
            self.assertEqual(status['status'], 'done', status)
            self.assertIsNone(status['starts'][1])
            self.assertGreaterEqual(status['starts'][0], 3.0)
            self.assertFalse(status['faces'])
            self.assertEqual(api.client.get('/api/face-finder').json(), {'ready': False})
            self.assertEqual(api.client.post(f"/api/photos/{media['id']}/reframe", json={'start': 0, 'end': 2}).status_code, 409, 'never downloads without asking')
        finally:
            api.tearDown()
