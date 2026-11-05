"""Ask AI: the shared AI connection (OpenAI library), edit plans, caption translation and post words, against a fake provider."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import edit_plan_service, text_ai_service

OPTIONS = {'themes': [{'id': 'wedding', 'label': 'Wedding'}], 'looks': [{'id': 'warm', 'label': 'Warm'}], 'transitions': [{'id': 'crossfade', 'label': 'Crossfade'}],
           'effects': [{'id': 'confetti', 'label': 'Confetti'}], 'formats': [{'id': 'reels', 'label': 'Reels'}], 'stories': [{'id': 'wedding', 'label': 'Wedding highlights'}],
           'title_styles': [{'id': 'cinematic', 'label': 'Cinematic'}]}
PROJECT = {'format': 'Reels', 'duration': 20, 'clip_count': 3, 'clips': [{'kind': 'video', 'name': 'a.mp4', 'length': 8, 'start': 0}], 'captions': ['வணக்கம்']}


class Provider:
    """A fake OpenAI-compatible chat API that answers with whatever the test sets."""
    def __init__(self):
        self.reply = '{}'
        self.status = 200
        self.requests = []

    def __call__(self, request: httpx.Request):
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={'error': {'message': 'nope'}})
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': self.reply}}]})


class Plans(unittest.TestCase):
    def ask(self, answer):
        return lambda system, user: answer

    def test_only_known_commands_and_ids_survive(self):
        answer = {'summary': 'A warm wedding reel.', 'commands': [
            {'name': 'set_theme', 'args': {'theme': 'wedding'}, 'why': 'mood'},
            {'name': 'set_look', 'args': {'look': 'warm', 'clips': 'all'}},
            {'name': 'set_transition', 'args': {'transition': 'crossfade', 'clips': [1, 2]}},  # Clip 1 can't take one.
            {'name': 'add_effect', 'args': {'effect': 'confetti', 'at': 18}},
            {'name': 'add_effect', 'args': {'effect': 'lasers', 'at': 1}},
            {'name': 'add_title', 'args': {'text': 'Pongal 2026', 'at': 99}},
            {'name': 'delete_everything', 'args': {}},
            {'name': 'add_captions', 'args': {'words': 9}},
            {'name': 'translate_captions', 'args': {'to': 'fr'}},
        ]}
        plan = edit_plan_service.plan('make it warm', PROJECT, OPTIONS, self.ask(answer))
        self.assertEqual(plan['summary'], 'A warm wedding reel.')
        self.assertEqual([command['name'] for command in plan['commands']], ['set_theme', 'set_look', 'add_effect', 'add_captions'])
        self.assertEqual(plan['commands'][3]['args'], {'words': 4})
        reasons = ' | '.join(item['reason'] for item in plan['dropped'])
        for expected in ('clip numbers must be 2 to 3', 'lasers', 'outside the video', 'unknown command', '"ta" or "en"'):
            self.assertIn(expected, reasons)

    def test_the_prompt_lists_the_editors_own_options_and_the_project(self):
        seen = {}
        edit_plan_service.plan('hello', PROJECT, OPTIONS, lambda system, user: seen.update(system=system, user=user) or {'commands': []})
        for text in ('set_theme(theme: theme id)', 'effect ids: confetti (Confetti)', "clip 1: video 'a.mp4'", 'வணக்கம்', 'The request:\nhello'):
            self.assertIn(text, seen['user'])

    def test_translation_keeps_one_line_per_caption(self):
        self.assertEqual(edit_plan_service.translate(['Hello', 'Thanks'], 'ta', self.ask({'lines': ['1. வணக்கம்', 'நன்றி']})), ['வணக்கம்', 'நன்றி'])
        with self.assertRaises(ValueError):
            edit_plan_service.translate(['Hello', 'Thanks'], 'ta', self.ask({'lines': ['வணக்கம்']}))

    def test_post_words_are_tidied(self):
        post = edit_plan_service.describe(PROJECT, 'both', self.ask({'title': 'Our Pongal', 'description': 'A day at home.', 'hashtags': ['pongal', '#family', '']}))
        self.assertEqual(post['hashtags'], ['#pongal', '#family'])

    def test_replies_wrapped_in_words_or_fences_are_read(self):
        self.assertEqual(text_ai_service.first_json('Sure! ```json\n{"a": 1}\n``` Enjoy'), {'a': 1})
        self.assertEqual(text_ai_service.first_json('Here: {"a": {"b": 2}} done'), {'a': {'b': 2}})
        with self.assertRaises(ValueError):
            text_ai_service.first_json('no json here')


class Api(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        self.provider = Provider()
        self.patches = [patch.object(settings, 'data_dir', root / 'data'), patch.object(settings, 'thumbnail_dir', root / 'thumbs'),
                        patch.object(settings, 'edit_workspace_dir', root / 'exports'), patch.object(text_ai_service, 'transport', httpx.MockTransport(self.provider))]
        for item in self.patches: item.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches): item.stop()
        self.folder.cleanup()

    def settings(self, **body):
        return self.client.put('/api/ai-settings', json={'model': 'image-model', **body})

    def test_ask_ai_shares_the_image_connection_with_its_own_text_model(self):
        self.assertFalse(self.client.get('/api/ai-settings').json()['text_configured'])
        self.assertEqual(self.settings(base_url='http://example.com/v1').status_code, 400, 'plain http only for this Mac')
        local = self.settings(base_url='http://localhost:11434/v1', text_model='qwen').json()
        self.assertTrue(local['text_configured'], 'a provider on this Mac needs no key'); self.assertTrue(local['local'])
        self.assertFalse(local['configured'], 'image generation still needs a key')
        cloud = self.settings(base_url='https://api.example.com/v1').json()
        self.assertEqual(cloud['text_model'], 'qwen', 'leaving the text model out keeps it')
        self.assertFalse(cloud['text_configured'], 'a cloud provider needs a key')
        saved = self.settings(base_url='https://api.example.com/v1', api_key='sk-secret', text_model='chat-model').json()
        self.assertTrue(saved['configured']); self.assertTrue(saved['text_configured'])
        self.assertNotIn('sk-secret', json.dumps(self.client.get('/api/ai-settings').json()))
        self.assertEqual(self.settings(base_url='https://api.example.com/v1', text_model='').json()['text_configured'], False, 'clearing it turns Ask AI off')

    def test_plans_go_through_the_openai_library_with_the_key_and_text_model(self):
        self.assertEqual(self.client.post('/api/ai/plan', json={'request': 'x', 'options': OPTIONS}).status_code, 409, 'not connected yet')
        self.settings(base_url='https://api.example.com/v1', api_key='sk-secret', text_model='chat-model')
        self.provider.reply = '```json\n{"summary": "Done", "commands": [{"name": "set_look", "args": {"look": "warm", "clips": "all"}}]}\n```'
        plan = self.client.post('/api/ai/plan', json={'request': 'warm it up', 'project': PROJECT, 'options': OPTIONS}).json()
        self.assertEqual(plan['commands'][0]['args'], {'look': 'warm', 'clips': 'all'})
        request = self.provider.requests[-1]
        self.assertEqual(str(request.url), 'https://api.example.com/v1/chat/completions')
        self.assertEqual(request.headers['authorization'], 'Bearer sk-secret')
        self.assertEqual(json.loads(request.content)['model'], 'chat-model', 'the text model, not the image model')

    def test_provider_trouble_is_explained(self):
        self.settings(base_url='http://localhost:11434/v1', text_model='qwen')
        self.provider.status = 401
        response = self.client.post('/api/ai/translate', json={'lines': ['Hello'], 'to': 'ta'})
        self.assertEqual(response.status_code, 502)
        self.assertIn('refused the API key', response.json()['detail'])
        self.provider.status = 404
        self.assertIn('no model called "qwen"', self.client.post('/api/ai/translate', json={'lines': ['Hello'], 'to': 'ta'}).json()['detail'])
        self.provider.status = 200
        self.provider.reply = 'I would rather not.'
        self.assertIn('expected form', self.client.post('/api/ai/describe', json={'project': PROJECT}).json()['detail'])
        self.provider.reply = '{"lines": ["வணக்கம்"]}'
        self.assertEqual(self.client.post('/api/ai/translate', json={'lines': ['Hello'], 'to': 'ta'}).json(), {'lines': ['வணக்கம்']})

if __name__ == '__main__':
    unittest.main()
