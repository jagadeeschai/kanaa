"""Bring to life: both provider styles end to end against fake providers (no network), failures, and settings."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import httpx
from PIL import Image

from app.services import ai_video

VIDEO = b'\x00\x00\x00\x18ftypmp42' + b'v' * 4000


class Flows(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.picture = self.root / 'scene.webp'
        Image.new('RGB', (3000, 2000), 'teal').save(self.picture, 'WEBP')
        self.row = {'id': 5, 'filename': 'AI scene 8.png', 'absolute_path': str(self.picture), 'media_type': 'image', 'folder': 'தமிழும் நானும்'}
        self.jobs, self.requests = [], []
        patches = [mock.patch.object(ai_video, 'get_media', return_value=self.row),
                   mock.patch.object(ai_video, 'enqueue_render', side_effect=lambda kind, label, run, **_: self.jobs.append(run) or 'job-1'),
                   mock.patch.object(ai_video, 'update_job'), mock.patch.object(ai_video, 'POLL_SECONDS', 0),
                   mock.patch.object(ai_video.settings, 'data_dir', self.root)]
        for patch in patches:
            patch.start(); self.addCleanup(patch.stop)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def provider(self, handler, style):
        ai_video.save_settings(style, 'https://video.example/api/v1', 'some/model', '720p', api_key='secret-key')
        real = httpx.Client
        return mock.patch.object(ai_video.httpx, 'Client', lambda **kw: real(transport=httpx.MockTransport(handler), **kw))

    def run_job(self, should_cancel=lambda: False):
        with mock.patch.object(ai_video, 'index_media', return_value={'id': 77}) as index:
            result = self.jobs[0](should_cancel)
        return result, index

    def test_atlas_style_submits_waits_and_downloads(self):
        polls = []

        def handler(request: httpx.Request):
            self.requests.append(request)
            assert request.headers['Authorization'] == 'Bearer secret-key'
            if request.url.path.endswith('/model/generateVideo'):
                body = json.loads(request.content)
                self.body = body
                return httpx.Response(200, json={'code': 200, 'data': {'id': 'p1', 'status': 'processing'}})
            if request.url.path.endswith('/model/prediction/p1'):
                polls.append(1)
                done = len(polls) >= 3
                return httpx.Response(200, json={'data': {'id': 'p1', 'status': 'completed' if done else 'processing', 'outputs': ['https://cdn.example/v.mp4'] if done else []}})
            if request.url.host == 'cdn.example':
                return httpx.Response(200, content=VIDEO)
            return httpx.Response(404)
        with self.provider(handler, 'atlas'):
            ai_video.start(5, 'hair moving in the wind', seconds=8)
            result, index = self.run_job()
        self.assertEqual(result, {'progress': 100, 'media_id': 77})
        self.assertEqual((self.body['model'], self.body['duration'], self.body['resolution'], self.body['generate_audio'], self.body['shot_type']), ('some/model', 8, '720p', False, 'single'))
        self.assertTrue(self.body['image'].startswith('data:image/jpeg;base64,'))  # WebP sent as a plain JPEG.
        self.assertIn('hair moving in the wind', self.body['prompt'])
        saved, name = index.call_args.args
        self.assertEqual((saved.read_bytes(), name, index.call_args.kwargs['folder']), (VIDEO, 'AI scene 8 (AI motion).mp4', 'தமிழும் நானும்'))
        self.assertEqual(len(polls), 3)

    def test_openai_style(self):
        def handler(request: httpx.Request):
            if request.method == 'POST' and request.url.path.endswith('/videos'):
                assert b'input_reference' in request.content and b'some/model' in request.content
                return httpx.Response(200, json={'id': 'v9', 'status': 'queued'})
            if request.url.path.endswith('/videos/v9'):
                return httpx.Response(200, json={'id': 'v9', 'status': 'completed'})
            if request.url.path.endswith('/videos/v9/content'):
                return httpx.Response(200, content=VIDEO)
            return httpx.Response(404)
        with self.provider(handler, 'openai'):
            ai_video.start(5, 'slow push in')
            result, _ = self.run_job()
        self.assertEqual(result['media_id'], 77)

    def test_failures_are_plain_and_leave_nothing(self):
        cases = [(lambda r: httpx.Response(402, text='no balance'), 'balance'),
                 (lambda r: httpx.Response(401), 'key'),
                 (lambda r: httpx.Response(200, json={'data': {'id': 'p1'}}) if r.url.path.endswith('generateVideo') else httpx.Response(200, json={'data': {'status': 'failed', 'error': 'unsafe content'}}), 'unsafe content')]
        for handler, words in cases:
            self.jobs.clear()
            with self.provider(handler, 'atlas'):
                ai_video.start(5, 'move')
                with self.assertRaises(ValueError) as caught:
                    self.run_job()
            self.assertIn(words, str(caught.exception))
            self.assertFalse(any(p.suffix == '.mp4' for p in (self.root / 'media').glob('*')) if (self.root / 'media').exists() else False)

    def test_cancel_while_waiting(self):
        def handler(request):
            if request.url.path.endswith('generateVideo'):
                return httpx.Response(200, json={'data': {'id': 'p1'}})
            return httpx.Response(200, json={'data': {'status': 'processing'}})
        calls = []
        with self.provider(handler, 'atlas'):
            ai_video.start(5, 'move')
            with self.assertRaises(ai_video.JobCancelled):
                self.run_job(lambda: calls.append(1) or len(calls) > 3)

    def test_settings_hide_the_key_and_check_the_address(self):
        shown = ai_video.save_settings('atlas', 'https://api.atlascloud.ai/api/v1/', 'alibaba/wan-2.6/image-to-video-flash', '720p', api_key='k-123')
        self.assertNotIn('k-123', json.dumps(shown))
        self.assertEqual((shown['configured'], shown['base_url']), (True, 'https://api.atlascloud.ai/api/v1'))
        self.assertEqual(ai_video.save_settings('atlas', 'https://api.atlascloud.ai/api/v1', 'm', '720p')['configured'], True)  # Blank keeps the key.
        for bad in ('http://example.com/v1', 'https://user:pw@example.com', 'ftp://x'):
            with self.assertRaises(ValueError):
                ai_video.save_settings('atlas', bad, 'm', '720p')
        self.assertFalse(ai_video.save_settings('atlas', 'https://a.example', 'm', '720p', clear_key=True)['configured'])

    def test_refuses_without_key_videos_and_empty_prompt(self):
        with self.assertRaises(ValueError):
            ai_video.start(5, 'move')  # No key saved yet.
        ai_video.save_settings('atlas', 'https://a.example', 'm', '720p', api_key='k')
        with self.assertRaises(ValueError):
            ai_video.start(5, '  ')
        self.row['media_type'] = 'video'
        with self.assertRaises(ValueError):
            ai_video.start(5, 'move')


if __name__ == '__main__':
    unittest.main()
