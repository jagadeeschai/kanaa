import asyncio
import base64
import io
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from PIL import Image
from app.main import app
from app.core.config import settings
from app.db.database import get_connection

RealAsyncClient = httpx.AsyncClient


class LyricImagesTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.patches = [patch.dict(os.environ, {'OPENAI_API_KEY': ''}), *[patch.object(settings, key, self.root / value) for key, value in [('data_dir', 'data'), ('thumbnail_dir', 'thumbs'), ('edit_workspace_dir', 'exports')]]]
        for item in self.patches: item.start()
        self.client = TestClient(app); self.client.__enter__()
        stream = io.BytesIO(); Image.new('RGB', (80, 120), 'purple').save(stream, 'PNG')
        self.png = stream.getvalue()
        media = self.client.post('/api/media', files={'file': ('background.png', self.png)}).json()
        self.project = self.client.post('/api/projects', json={'name': 'AI lyrics', 'kind': 'lyric', 'media_id': media['id']}).json()['id']
        self.prefix = f'/api/projects/{self.project}/image-scenes'
        self.calls = []

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches): item.stop()
        self.folder.cleanup()

    def plan(self):
        lyrics = 'கடல் அலைகள்\nMorning light\nCarry me home'
        return self.client.post(self.prefix + '/plan', json={'lyrics': lyrics, 'count': 3, 'brief': 'Coastal village at dawn', 'style': 'watercolor', 'canvas': 'portrait', 'cues': [{'text': line, 'start': index * 2, 'end': index * 2 + 2} for index, line in enumerate(lyrics.splitlines())]}).json()

    def configure(self):
        response = self.client.put('/api/ai-settings', json={'api_key': 'test-private-key', 'base_url': 'http://127.0.0.1:18801/v1', 'model': 'test-image'})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('test-private-key', response.text)

    def transport(self, handler):
        return patch('app.services.lyric_image_service.httpx.AsyncClient', side_effect=lambda **kwargs: RealAsyncClient(transport=httpx.MockTransport(handler), **kwargs))

    def wait(self, identifier):
        for _ in range(150):
            result = self.client.get(f'/api/jobs/{identifier}/status').json()
            if result['done']: return result
            time.sleep(.05)
        self.fail('Image job did not finish')

    def generate(self, batch, scenes=None):
        return self.client.post(self.prefix + '/generate', json={'batch_id': batch['id'], 'scenes': [{'id': scene['id'], 'prompt': scene['prompt']} for scene in (scenes or batch['scenes'])], 'quality': 'medium'})

    def test_local_planning_unicode_and_settings_redaction(self):
        batch = self.plan()
        self.assertEqual(len(batch['scenes']), 3)
        self.assertIn('கடல் அலைகள்', batch['scenes'][0]['prompt'])
        self.assertIn('Coastal village at dawn', batch['scenes'][2]['prompt'])
        self.assertEqual([scene['start'] for scene in batch['scenes']], [0, 2, 4])
        self.assertEqual(self.generate(batch).status_code, 400)
        self.configure()
        self.assertTrue(self.client.get('/api/ai-settings').json()['configured'])
        self.assertNotIn('test-private-key', self.client.get('/api/ai-settings').text)
        self.assertEqual((settings.data_dir / 'ai-settings.json').stat().st_mode & 0o777, 0o600)
        prompt = 'A calm beach in Tamil Nadu, no text'
        self.assertEqual(self.client.patch(self.prefix + '/' + batch['id'], json={'scenes': [{'id': batch['scenes'][0]['id'], 'prompt': prompt}]}).status_code, 200)
        self.assertEqual(self.client.get(self.prefix).json()['batch']['scenes'][0]['prompt'], prompt)
        self.assertEqual(self.client.put('/api/ai-settings', json={'base_url': 'http://evil.example/v1', 'model': 'test'}).status_code, 400)

    def test_lyric_project_can_start_without_upload(self):
        response = self.client.post('/api/projects', json={'name': 'AI-only start', 'kind': 'lyric'})
        self.assertEqual(response.status_code, 200)
        project = response.json()
        media = self.client.get(f"/api/photos/{project['media_id']}").json()
        self.assertEqual(media['filename'], 'Blank canvas.png')
        self.assertEqual(media['media_type'], 'image')
        self.assertEqual(self.client.get(f"/api/photos/{media['id']}/image").status_code, 200)
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'environment-only-test-secret'}):
            response = self.client.put('/api/ai-settings', json={'model': 'test-image'})
            self.assertEqual(response.json()['key_source'], 'environment')
            self.assertNotIn('environment-only-test-secret', (settings.data_dir / 'ai-settings.json').read_text())

    def test_partial_failure_retry_and_real_saved_image(self):
        self.configure(); batch = self.plan()
        def handler(request):
            self.calls.append(json.loads(request.content))
            self.assertEqual(request.headers['authorization'], 'Bearer test-private-key')
            self.assertEqual(request.url.path, '/v1/images/generations')
            if len(self.calls) == 2: return httpx.Response(429, json={'error': 'test-private-key should not leak'})
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(self.png).decode()}]})
        with self.transport(handler):
            response = self.generate(batch); self.assertEqual(response.status_code, 200)
            result = self.wait(response.json()['job_id'])
            self.assertIsNone(result['error']); self.assertIn('1 scene', result['warning'])
            scenes = self.client.get(self.prefix).json()['batch']['scenes']
            self.assertEqual([scene['status'] for scene in scenes], ['done', 'failed', 'done'])
            self.assertNotIn('test-private-key', json.dumps(scenes))
            generated = scenes[0]['media_id']
            image = self.client.get(f'/api/photos/{generated}/image')
            self.assertEqual(Image.open(io.BytesIO(image.content)).size, (80, 120))
            failed = [scene for scene in scenes if scene['status'] == 'failed']
            retry = self.generate(batch, failed); self.assertEqual(retry.status_code, 200)
            self.assertIsNone(self.wait(retry.json()['job_id'])['error'])
            after = self.client.get(self.prefix).json()['batch']['scenes']
            self.assertTrue(all(scene['status'] == 'done' for scene in after))
            self.assertEqual(after[0]['media_id'], generated)
            self.assertEqual(len(self.calls), 4)
            self.assertEqual(self.calls[0]['size'], '1024x1536')
            self.assertEqual(self.calls[0]['n'], 1)
            self.assertNotIn('response_format', self.calls[0])
            self.assertEqual(self.generate(batch).status_code, 400)
        self.assertEqual(self.client.get('/api/photos?collection=imports').json()['total'], 4)
        self.assertEqual(self.client.get(f'/api/projects/{self.project}').json()['recipe'], None)

    def test_cancellation_stops_remaining_requests(self):
        self.configure(); batch = self.plan(); entered = threading.Event()
        async def handler(request):
            self.calls.append(request)
            entered.set()
            await asyncio.sleep(10)
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(self.png).decode()}]})
        with self.transport(handler):
            identifier = self.generate(batch).json()['job_id']
            self.assertTrue(entered.wait(3))
            self.assertEqual(self.generate(batch).status_code, 400)
            self.assertEqual(self.client.delete(f'/api/projects/{self.project}').status_code, 409)
            self.client.post(f'/api/jobs/{identifier}/cancel')
            self.assertEqual(self.wait(identifier)['status'], 'cancelled')
            scenes = self.client.get(self.prefix).json()['batch']['scenes']
            self.assertTrue(all(scene['status'] == 'cancelled' for scene in scenes))
            self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.client.get('/api/photos?collection=imports').json()['total'], 1)

    def test_bad_provider_output_and_foreign_scene_are_rejected(self):
        self.configure(); batch = self.plan()
        self.assertEqual(self.client.post(self.prefix + '/generate', json={'batch_id': batch['id'], 'scenes': [{'id': 999999, 'prompt': 'wrong'}]}).status_code, 400)
        with self.transport(lambda request: httpx.Response(200, json={'data': [{'b64_json': 'bad'}]})):
            response = self.generate(batch)
            self.assertIn('No images', self.wait(response.json()['job_id'])['error'])
        self.assertEqual(self.client.get('/api/photos?collection=imports').json()['total'], 1)
        self.assertEqual(len(list((settings.data_dir / 'media').glob('ai-*'))), 0)


if __name__ == '__main__': unittest.main()
