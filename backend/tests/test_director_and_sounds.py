"""The lyric video director, and whooshes and hits."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import numpy as np
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import lyric_director_service, sound_effect_service, text_ai_service

LYRICS = ['கண்ணே கலைமானே', 'கன்னி மயிலென கண்டேன் உனை நானே', 'அந்திப் பகல் உனை நான் பார்க்கிறேன்', 'ஆண்டவன் அருள் வேண்டும் என்று', 'ஓடும் மேகங்களே', 'ஒரு சொல் கேளீரோ']


def answer(scenes, bible='The same young Tamil couple in traditional clothes, a village by a temple pond at golden hour, warm amber palette, soft 35 mm film look.'):
    return lambda system, user: {'bible': bible, 'scenes': scenes}


class Director(unittest.TestCase):
    def test_scenes_follow_the_lyrics_sections_in_order_and_cover_every_line(self):
        plan = lyric_director_service.direct(LYRICS, 3, 'cinematic', 'portrait', ask=answer([
            {'first_line': 1, 'last_line': 2, 'mood': 'tender', 'visual': 'She looks up from the pond, smiling.'},
            {'first_line': 3, 'last_line': 4, 'mood': 'longing', 'visual': 'He waits by the temple steps at dusk.'},
            {'first_line': 5, 'last_line': 6, 'mood': 'hopeful', 'visual': 'Clouds drift over the paddy fields.'}]))
        self.assertEqual([(scene['first'], scene['end']) for scene in plan['scenes']], [(0, 2), (2, 4), (4, 6)])
        self.assertIn('temple pond', plan['bible'])

    def test_gaps_and_overlaps_are_joined_and_the_last_scene_reaches_the_end(self):
        plan = lyric_director_service.direct(LYRICS, 3, 'cinematic', 'portrait', ask=answer([
            {'first_line': 1, 'last_line': 3, 'visual': 'One.'}, {'first_line': 2, 'last_line': 3, 'visual': 'Overlaps entirely.'},
            {'first_line': 5, 'last_line': 5, 'visual': 'Skips line 4.'}]))
        self.assertEqual([(scene['first'], scene['end']) for scene in plan['scenes']], [(0, 3), (3, 6)])

    def test_image_words_are_plain_english_and_bad_answers_are_refused(self):
        plan = lyric_director_service.direct(LYRICS, 1, 'cinematic', 'portrait', ask=answer([{'first_line': 1, 'last_line': 6, 'visual': 'A café by the sea — கண்ணே'}]))
        self.assertEqual(plan['scenes'][0]['visual'], 'A cafe by the sea')
        with self.assertRaises(ValueError):
            lyric_director_service.direct(LYRICS, 2, 'cinematic', 'portrait', ask=answer([], bible='short'))
        with self.assertRaises(ValueError):
            lyric_director_service.direct(LYRICS, 2, 'cinematic', 'portrait', ask=answer([{'first_line': 'x'}]))

    def test_the_lyrics_and_wishes_reach_the_text_model(self):
        seen = {}
        lyric_director_service.direct(LYRICS, 2, 'watercolor', 'square', 'blue sarees', ask=lambda system, user: seen.update(user=user) or answer([{'first_line': 1, 'last_line': 6, 'visual': 'x'}])(system, user))
        for text in ('Scenes: 2', 'watercolor', 'blue sarees', '1. கண்ணே கலைமானே', '6 lines'):
            self.assertIn(text, seen['user'])


class Provider:
    def __init__(self):
        self.reply = {}
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': json.dumps(self.reply, ensure_ascii=False)}}]})


class Api(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.provider = Provider()
        (self.root / 'music').mkdir()
        self.patches = [patch.object(settings, key, self.root / value) for key, value in [('data_dir', 'data'), ('thumbnail_dir', 'thumbs'), ('edit_workspace_dir', 'exports')]]
        self.patches += [patch.object(text_ai_service, 'transport', httpx.MockTransport(self.provider)), patch.dict(os.environ, {'KANAA_MUSIC_DIR': str(self.root / 'music')})]
        for item in self.patches: item.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches): item.stop()
        self.folder.cleanup()

    def test_directed_scenes_are_saved_like_a_plan_without_lyrics_in_the_prompts(self):
        project = self.client.post('/api/projects', json={'name': 'Song', 'kind': 'lyric'}).json()
        body = {'lyrics': '\n'.join(LYRICS), 'count': 2, 'style': 'cinematic', 'canvas': 'portrait', 'brief': ''}
        self.assertEqual(self.client.post(f"/api/projects/{project['id']}/image-scenes/direct", json=body).status_code, 409, 'needs a text model')
        self.client.put('/api/ai-settings', json={'base_url': 'http://localhost:11434/v1', 'model': 'image', 'text_model': 'chat'})
        self.provider.reply = {'bible': 'The same young Tamil couple, a temple pond village at golden hour, amber palette.',
                               'scenes': [{'first_line': 1, 'last_line': 3, 'visual': 'She smiles by the pond.'}, {'first_line': 4, 'last_line': 6, 'visual': 'Clouds over paddy fields.'}]}
        batch = self.client.post(f"/api/projects/{project['id']}/image-scenes/direct", json=body).json()
        self.assertEqual([scene['lyric'] for scene in batch['scenes']], ['\n'.join(LYRICS[:3]), '\n'.join(LYRICS[3:])])
        self.assertIn('She smiles by the pond.', batch['scenes'][0]['prompt'])
        self.assertIn('temple pond village', batch['scenes'][1]['prompt'], 'every scene carries the bible')
        for scene in batch['scenes']:
            self.assertFalse(any(line in scene['prompt'] for line in LYRICS), 'lyrics never reach image prompts')
        self.assertIn('கண்ணே கலைமானே', json.loads(self.provider.requests[-1].content)['messages'][1]['content'], 'the text model reads them')

    def test_kanaa_makes_its_own_whoosh_and_hit_and_finds_the_librarys(self):
        for name, filters in (('Swoosh Fast', "aevalsrc='sin(2*PI*900*t)*if(lt(t,0.8),t/0.8,max(0,(1.2-t)/0.4))':d=1.2"), ('Big Impact 02', 'sine=f=60:d=1'), ('Calm Piano', 'sine=f=440:d=2')):
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', filters, '-c:a', 'libmp3lame', str(self.root / 'music' / f'{name}.mp3')], check=True)
        effects = self.client.get('/api/sound-effects').json()['effects']
        self.assertEqual([(effect['kind'], effect['name']) for effect in effects], [('whoosh', "Kanaa's whoosh"), ('hit', "Kanaa's hit"), ('thunder', 'Thunder'), ('hit', 'Big Impact 02'), ('whoosh', 'Swoosh Fast')])
        own = self.client.post('/api/sound-effects/kanaa-whoosh/use').json()
        self.assertEqual((own['kind'], own['peak']), ('whoosh', 0.5))
        self.assertEqual(self.client.get(f"/api/video-audio/{own['asset_id']}").status_code, 200)
        library = next(effect for effect in effects if effect['name'] == 'Swoosh Fast')
        used = self.client.post(f"/api/sound-effects/{library['id']}/use").json()
        self.assertAlmostEqual(used['peak'], 0.8, delta=0.15, msg='the swoosh is loudest where its fade-in ends')
        self.assertEqual(self.client.post('/api/sound-effects/not-an-effect/use').status_code, 404)
        self.assertEqual(self.client.post('/api/sound-effects/0123456789abcdef/use').status_code, 404, 'a well-formed id that is not in the library')

    def test_the_made_sounds_have_their_shape(self):
        whoosh = sound_effect_service.make_whoosh()
        envelope = np.convolve(np.abs(whoosh), np.ones(2205) / 2205, mode='same')
        self.assertAlmostEqual(np.argmax(envelope) / sound_effect_service.RATE, 0.5, delta=0.08)
        hit = sound_effect_service.make_hit()
        self.assertGreater(np.abs(hit[:4410]).mean(), np.abs(hit[-4410:]).mean() * 10, 'a hit dies away')
        thunder = sound_effect_service.make_thunder()
        self.assertEqual(len(thunder), 5 * sound_effect_service.RATE)
        self.assertGreater(float(np.max(np.abs(thunder))), 0.5)


if __name__ == '__main__':
    unittest.main()
