import hashlib
import io
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient
from app.core.config import settings
from app.main import app
from app.services.video_service import _run_ffprobe


class StudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        cls.video = Path(cls.fixture.name) / 'source.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=240x160:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(cls.video)], check=True, capture_output=True)
        cls.original = hashlib.sha256(cls.video.read_bytes()).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.patches = [patch.object(settings, key, self.root / value) for key, value in [('data_dir', 'data'), ('thumbnail_dir', 'thumbs'), ('edit_workspace_dir', 'exports')]]
        for item in self.patches: item.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches): item.stop()
        self.assertEqual(hashlib.sha256(self.video.read_bytes()).hexdigest(), self.original)
        self.folder.cleanup()

    def image(self, color):
        stream = io.BytesIO(); Image.new('RGB', (200, 120), color).save(stream, 'PNG')
        response = self.client.post('/api/media', files={'file': (f'{color}.png', stream.getvalue(), 'image/png')})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def wait_job(self, identifier):
        for _ in range(400):
            job = self.client.get(f'/api/jobs/{identifier}/status').json()
            if job['done']:
                self.assertIsNone(job['error']); return job
            time.sleep(.05)
        self.fail('Export did not complete')

    def test_independent_projects_and_import_validation(self):
        media = self.image('red')
        first = self.client.post('/api/projects', json={'name': 'First', 'kind': 'lyric', 'media_id': media['id']}).json()
        second = self.client.post('/api/projects', json={'name': 'Second', 'kind': 'lyric', 'media_id': media['id']}).json()
        self.client.put(f"/api/projects/{first['id']}/recipe", json={'recipe': {'lyrics': 'Hello'}})
        self.assertIsNone(self.client.get(f"/api/projects/{second['id']}").json()['recipe'])
        copied = self.client.post(f"/api/projects/{first['id']}/duplicate").json()
        self.assertEqual(self.client.get(f"/api/projects/{copied['id']}").json()['recipe']['lyrics'], 'Hello')
        self.client.patch(f"/api/projects/{copied['id']}", json={'name': 'Renamed'})
        self.assertEqual(self.client.get(f"/api/projects/{copied['id']}").json()['name'], 'Renamed')
        self.client.delete(f"/api/projects/{first['id']}")
        self.assertEqual(self.client.get(f"/api/photos/{media['id']}/image").status_code, 200)
        self.assertEqual(self.client.post('/api/media', files={'file': ('bad.mp4', b'bad video')}).status_code, 400)
        self.assertEqual(len(list((settings.data_dir / 'media').iterdir())), 1)
        image_edit = self.client.post('/api/projects', json={'name': 'Image edit', 'kind': 'edit', 'media_id': media['id']})
        self.assertEqual(image_edit.status_code, 200)
        self.assertEqual(self.client.get(f"/api/projects/{image_edit.json()['id']}/timeline").status_code, 200)

    def test_media_folders_are_persistent_filterable_and_manageable(self):
        red, blue = self.image('red'), self.image('blue')
        created = self.client.post('/api/media-folders', json={'name': 'Interviews'})
        self.assertEqual(created.status_code, 200)
        self.assertEqual(self.client.get('/api/media-folders').json()['folders'][0], {'name': 'Interviews', 'count': 0})
        moved = self.client.patch('/api/photos/folder', json={'ids': [red['id'], blue['id']], 'folder': 'Interviews'})
        self.assertEqual(moved.json()['updated'], 2)
        filtered = self.client.get('/api/photos', params={'collection': 'imports', 'folder': 'Interviews'}).json()
        self.assertEqual(filtered['total'], 2)
        renamed = self.client.patch('/api/media-folders/Interviews', json={'name': 'Client interviews'})
        self.assertEqual(renamed.json()['name'], 'Client interviews')
        self.assertEqual(self.client.get('/api/media-folders').json()['folders'][0]['count'], 2)
        self.assertEqual(self.client.delete('/api/media-folders/Client%20interviews').status_code, 204)
        self.assertEqual(self.client.get('/api/photos', params={'collection': 'imports', 'folder': '__unfiled__'}).json()['total'], 2)

    def test_video_import_trim_export_and_download(self):
        media = self.client.post('/api/media', files={'file': ('clip.mp4', self.video.read_bytes(), 'video/mp4')}).json()
        self.assertEqual(self.client.get(f"/api/photos/{media['id']}/thumbnail").status_code, 200)
        stream = self.client.get(f"/api/photos/{media['id']}/video", headers={'Range': 'bytes=0-31'})
        self.assertEqual(stream.status_code, 206); self.assertEqual(len(stream.content), 32)
        response = self.client.post(f"/api/photos/{media['id']}/video-export", json={'trim_start': .2, 'trim_end': 1.2, 'mute': True})
        self.assertEqual(response.status_code, 200)
        job = self.wait_job(response.json()['job_id'])
        output = self.client.get(f"/api/photos/{job['output_photo_id']}").json()
        info = _run_ffprobe(Path(output['absolute_path']))
        self.assertAlmostEqual(float(info['format']['duration']), 1, delta=.12)
        self.assertFalse(any(stream['codec_type'] == 'audio' for stream in info['streams']))
        self.assertEqual(self.client.get('/api/photos?collection=workspace').json()['total'], 1)
        self.assertEqual(self.client.get(f"/api/photos/{output['id']}/download").status_code, 200)

    def test_lyrical_slideshow_upload_export_and_order(self):
        red, blue = self.image('red'), self.image('blue')
        audio = self.client.post('/api/video-audio', files={'file': ('song.mp4', self.video.read_bytes())}).json()
        project = self.client.post('/api/projects', json={'name': 'Song', 'kind': 'lyric', 'media_id': red['id'], 'media_ids': [red['id'], blue['id']]}).json()
        self.assertEqual(len(self.client.get(f"/api/projects/{project['id']}").json()['recipe']['clips']), 2)
        response = self.client.post(f"/api/photos/{red['id']}/video-export", json={'audio_asset_id': audio['asset_id'], 'background_photo_ids': [red['id'], blue['id']], 'canvas': 'square', 'trim_end': 2, 'lyrics': [{'start': 0, 'end': 2, 'text': 'Hello தமிழ்'}], 'image_animation': 'zoom-in', 'lyric_animation': 'fade'})
        self.assertEqual(response.status_code, 200, response.text)
        job = self.wait_job(response.json()['job_id'])
        output = self.client.get(f"/api/photos/{job['output_photo_id']}").json()
        for when, channel in [(0.4, 0), (1.5, 2)]:
            frame = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(when), '-i', output['absolute_path'], '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], check=True, capture_output=True).stdout
            self.assertGreater(frame[channel], frame[2 if channel == 0 else 0] + 100)
        info = _run_ffprobe(Path(output['absolute_path']))
        self.assertTrue(any(stream['codec_type'] == 'audio' for stream in info['streams']))
        self.assertEqual(self.client.get('/api/fonts/NotoSansTamil-Bold.ttf').status_code, 200)

    def test_failed_export_leaves_nothing_behind(self):
        from app.api import routes
        media = self.client.post('/api/media', files={'file': ('source.mp4', self.video.read_bytes(), 'video/mp4')}).json()
        with patch.object(routes, 'index_media', side_effect=RuntimeError('Test indexing failure')):
            job_id = self.client.post(f"/api/photos/{media['id']}/video-export", json={'trim_end': 0.5}).json()['job_id']
            for _ in range(200):
                job = self.client.get(f'/api/jobs/{job_id}/status').json()
                if job['done']:
                    break
                time.sleep(0.05)
        self.assertEqual(job['status'], 'failed')
        self.assertIn('Test indexing failure', job['error'])
        self.assertFalse(list(settings.edit_workspace_dir.rglob('*.mp4')))

if __name__ == '__main__': unittest.main()
