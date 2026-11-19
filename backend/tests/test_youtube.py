"""Publish to YouTube against a fake Google (no network): the client file, sign-in, a resumable upload that survives a
dropped connection, the extras (thumbnail, captions, playlist) and plain-words failures."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import httpx

from app.services import youtube_service as youtube

CLIENT = json.dumps({'installed': {'client_id': 'abc.apps.googleusercontent.com', 'client_secret': 'shh', 'redirect_uris': ['http://localhost']}})


class Google:
    """Just enough of Google's token, channel and resumable-upload endpoints."""

    def __init__(self, size, drop_at=None, thumbnail_status=200):
        self.size, self.drop_at, self.thumbnail_status = size, drop_at, thumbnail_status
        self.received = bytearray()
        self.calls: list[str] = []
        self.dropped = False
        self.metadata = None
        self.captions: list[bytes] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append(f'{request.method} {request.url.path}')
        if request.url.path == '/token':
            form = parse_qs(request.content.decode())
            if form['grant_type'] == ['authorization_code']:
                assert form['code_verifier'][0] and form['code'] == ['the-code']
                return httpx.Response(200, json={'access_token': 'A1', 'refresh_token': 'R1', 'expires_in': 3600})
            return httpx.Response(200, json={'access_token': 'A2', 'expires_in': 3600})
        if request.url.path.endswith('/channels'):
            return httpx.Response(200, json={'items': [{'id': 'UC1', 'snippet': {'title': 'Tamil Songs'}}]})
        if request.url.path == '/upload/youtube/v3/videos' and request.method == 'POST':
            assert request.headers['x-upload-content-length'] == str(self.size)
            self.metadata = json.loads(request.content)
            return httpx.Response(200, headers={'location': 'https://upload.test/session/1'})
        if url.startswith('https://upload.test/session/1') and request.method == 'PUT':
            given = request.headers['content-range']
            if given.startswith('bytes */'):
                return self._state()
            first = int(given.split(' ')[1].split('-')[0])
            assert first == len(self.received), 'resumed from the wrong byte'
            if self.drop_at is not None and not self.dropped and first >= self.drop_at:
                self.dropped = True
                return httpx.Response(503)
            self.received.extend(request.content)
            return self._state()
        if request.url.path.endswith('/thumbnails/set'):
            return httpx.Response(self.thumbnail_status, json={})
        if request.url.path.endswith('/captions'):
            self.captions.append(request.content)
            return httpx.Response(200, json={'id': 'cap1'})
        if request.url.path.endswith('/playlistItems'):
            return httpx.Response(200, json={'id': 'pi1'})
        return httpx.Response(404)

    def _state(self):
        if len(self.received) >= self.size:
            return httpx.Response(200, json={'id': 'VID123', 'status': {'privacyStatus': 'private'}})
        return httpx.Response(308, headers={'range': f'bytes=0-{len(self.received) - 1}'} if self.received else {})


class YouTubeTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.keychain: dict = {}
        for patch in [mock.patch.object(youtube.settings, 'data_dir', self.root),
                      mock.patch.object(youtube, 'keychain_read', lambda: self.keychain.get('v')),
                      mock.patch.object(youtube, 'keychain_write', lambda value: self.keychain.update(v=value)),
                      mock.patch.object(youtube, 'keychain_delete', lambda: self.keychain.clear()),
                      mock.patch.object(youtube.time, 'sleep', lambda _: None)]:
            patch.start(); self.addCleanup(patch.stop)
        youtube._access.clear(); youtube._pending.clear()

    def connect(self, google):
        youtube.save_client(CLIENT)
        address = youtube.sign_in_address('http://127.0.0.1:8010/api/youtube/callback')
        query = parse_qs(urlsplit(address).query)
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertIn('youtube.upload', query['scope'][0])
        return youtube.finish_sign_in(query['state'][0], 'the-code', httpx.Client(transport=httpx.MockTransport(google)))

    def test_client_file_checks(self):
        with self.assertRaises(youtube.YouTubeError):
            youtube.save_client('not json')
        with self.assertRaisesRegex(youtube.YouTubeError, 'Desktop app'):
            youtube.save_client(json.dumps({'web': {'client_id': 'x.apps.googleusercontent.com', 'client_secret': 's'}}))
        self.assertTrue(youtube.save_client(CLIENT)['client'])
        self.assertNotIn('shh', json.dumps(youtube.status()))

    def test_sign_in_keeps_the_token_in_the_keychain_only(self):
        found = self.connect(Google(1))
        self.assertEqual((found['connected'], found['channel']), (True, 'Tamil Songs'))
        self.assertEqual(self.keychain['v'], {'refresh_token': 'R1'})
        for file in self.root.iterdir():
            self.assertNotIn('R1', file.read_text())
        with self.assertRaisesRegex(youtube.YouTubeError, 'expired'):
            youtube.finish_sign_in('made-up', 'the-code', httpx.Client(transport=httpx.MockTransport(Google(1))))
        self.assertFalse(youtube.disconnect()['connected'])
        self.assertEqual(self.keychain, {})

    def test_resumable_upload_survives_a_dropped_chunk_and_adds_extras(self):
        data = bytes(range(256)) * 4000  # About 1 MB, sent in 256 KiB pieces.
        video = self.root / 'song.mp4'; video.write_bytes(data)
        picture = self.root / 'thumb.jpg'; picture.write_bytes(b'\xff\xd8jpeg')
        google = Google(len(data), drop_at=512 * 1024)
        self.connect(google)
        steps = []
        result = youtube.upload_video(video, {'title': 'தமிழும் நானும் <official>', 'description': 'Lyrics', 'tags': ['tamil', 'lyric video'],
                                              'privacy': 'public', 'language': 'ta', 'thumbnail': str(picture), 'playlist_id': 'PL1',
                                              'captions': [{'language': 'ta', 'name': 'Tamil lyrics', 'srt': '1\n00:00:01,000 --> 00:00:02,000\nவணக்கம்\n'}]},
                                      lambda value, phase: steps.append(value), lambda: False,
                                      http=httpx.Client(transport=httpx.MockTransport(google)), chunk=256 * 1024)
        self.assertEqual(bytes(google.received), data)
        self.assertTrue(google.dropped)
        self.assertEqual(result['youtube_id'], 'VID123')
        self.assertEqual(result['notes'], [])
        self.assertEqual(google.metadata['snippet']['title'], 'தமிழும் நானும் ‹official›')
        self.assertEqual(google.metadata['snippet']['defaultLanguage'], 'ta')
        self.assertEqual(google.metadata['status']['privacyStatus'], 'public')
        self.assertIn('வணக்கம்'.encode(), google.captions[0])
        self.assertEqual(steps[-1], 100)
        self.assertEqual(steps, sorted(steps))

    def test_thumbnail_refusal_is_a_note_not_a_failure(self):
        video = self.root / 'v.mp4'; video.write_bytes(b'x' * 1000)
        picture = self.root / 't.png'; picture.write_bytes(b'png')
        google = Google(1000, thumbnail_status=403)
        self.connect(google)
        result = youtube.upload_video(video, {'title': 'T', 'thumbnail': str(picture)}, lambda *_: None, lambda: False,
                                      http=httpx.Client(transport=httpx.MockTransport(google)))
        self.assertIn('verified channel', result['notes'][0])

    def test_scheduled_publish_and_quota(self):
        body = youtube.video_body({'title': 'T', 'privacy': 'public', 'publish_at': '2027-01-01T10:00:00Z', 'tags': ['a' * 100] * 10})
        self.assertEqual(body['status'], {'privacyStatus': 'private', 'publishAt': '2027-01-01T10:00:00Z', 'selfDeclaredMadeForKids': False, 'embeddable': True})
        self.assertLessEqual(sum(len(tag) + 1 for tag in body['snippet']['tags']), 480)
        quota = httpx.Response(403, json={'error': {'errors': [{'reason': 'quotaExceeded'}]}})
        self.assertIn('daily upload allowance', youtube._explain(quota))

    def test_thumbnail_fills_the_frame_and_fits_the_limit(self):
        from PIL import Image
        import numpy as np
        noisy = self.root / 'big.png'
        Image.fromarray(np.random.default_rng(1).integers(0, 255, (2000, 3000, 3), dtype=np.uint8)).save(noisy)
        made = youtube.make_thumbnail(noisy, self.root / 'thumb.jpg')
        with Image.open(made) as picture:
            self.assertEqual((picture.size, picture.format), ((1280, 720), 'JPEG'))
        self.assertLessEqual(made.stat().st_size, youtube.THUMB_LIMIT)
        with Image.open(youtube.make_thumbnail(noisy, self.root / 'tall.jpg', upright=True)) as picture:
            self.assertEqual(picture.size, (720, 1280))

    def test_thumbnail_from_a_video_frame(self):
        import shutil as tools, subprocess
        if not tools.which('ffmpeg'):
            self.skipTest('needs ffmpeg')
        clip = self.root / 'clip.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2', '-pix_fmt', 'yuv420p', str(clip)], check=True)
        from PIL import Image
        with Image.open(youtube.make_thumbnail(clip, self.root / 'f.jpg', at=1.0)) as picture:
            red, green, _ = picture.convert('RGB').getpixel((640, 360))
            self.assertEqual(picture.size, (1280, 720)); self.assertGreater(red, 200); self.assertLess(green, 60)
        self.assertEqual(sorted(path.name for path in self.root.glob('*.frame.png')), [])

    def test_not_connected(self):
        video = self.root / 'v.mp4'; video.write_bytes(b'x')
        youtube.save_client(CLIENT)
        with self.assertRaisesRegex(youtube.YouTubeError, 'Connect YouTube'):
            youtube.upload_video(video, {'title': 'T'}, lambda *_: None, lambda: False, http=httpx.Client(transport=httpx.MockTransport(Google(1))))


if __name__ == '__main__':
    unittest.main()
