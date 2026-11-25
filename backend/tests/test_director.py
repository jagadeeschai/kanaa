"""The AI director: its answer is kept to what Kanaa can make (known looks and choices, settings within range, in
order, at most four); it asks the vision model from AI settings with the clip's pictures; Kanaa's own fact sheet sees
the sky and the sun; and it needs a model set before it does anything."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import numpy as np

from app.core.config import settings
from app.services import ai_settings_service, director_service as director, text_ai_service


class Answers(unittest.TestCase):
    def test_a_messy_answer_is_kept_to_what_kanaa_can_make(self):
        found = director.checked({'summary': 'Warm and soft.', 'verdict': 'adjust', 'looks': [
            {'kind': 'lens', 'preset': 'portrait', 'strength': 'gigantic', 'tune': {'amount': 99, 'zoom': 2}, 'why': 'Her face stays sharp.'},
            {'kind': 'teleport', 'why': 'nope'},
            {'kind': 'new_sky', 'sky': 'aurora'},
            {'kind': 'atmosphere', 'preset': 'mist', 'strength': 'light', 'tune': {'density': 0.5}},
            {'kind': 'lens', 'preset': 'dreamy'},  # A second lens: ignored.
            {'kind': 'rays', 'preset': 'soft'}, {'kind': 'night', 'mood': 'dark'}]})
        kinds = [look['kind'] for look in found['looks']]
        self.assertEqual(kinds, ['new_sky', 'night', 'rays', 'atmosphere'])  # In order, unknown dropped, at most four.
        self.assertEqual(found['looks'][0]['sky'], 'sunset')  # An unknown choice falls back to the first.
        self.assertEqual(found['verdict'], 'adjust')
        lens = director.checked({'looks': [{'kind': 'lens', 'preset': 'portrait', 'strength': 'gigantic', 'tune': {'amount': 99, 'zoom': 2}}]})['looks'][0]
        self.assertEqual((lens['strength'], lens['tune']), ('medium', {'amount': 3.0}))  # Fixed and kept within range.
        with self.assertRaises(ValueError):
            director.checked(['not', 'an', 'object'])


class Asking(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.addCleanup(self.folder.cleanup)
        self.seen = []

        def provider(request: httpx.Request):
            self.seen.append(json.loads(request.content))
            return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content':
                'Here is my plan: ```json {"looks": [{"kind": "atmosphere", "preset": "mist", "strength": "light", "why": "Soft depth."}], "summary": "Quiet morning."} ```'}}]})
        for item in [patch.object(settings, 'data_dir', Path(self.folder.name)), patch.object(text_ai_service, 'transport', httpx.MockTransport(provider))]:
            item.start(); self.addCleanup(item.stop)

    def test_it_needs_a_model_first(self):
        with self.assertRaises(text_ai_service.NotConfigured):
            director.vision_client()

    def test_it_asks_the_vision_model_with_the_pictures(self):
        ai_settings_service.save_settings('key', 'https://ai.example.com/v1', 'image-model', text_model='chat-model', vision_model='eyes-model')
        frames = [np.full((90, 160, 3), shade, np.uint8) for shade in (60, 120, 180)]
        found = director.ask({'sky_share': 0.3}, frames, wish='a quiet morning')
        self.assertEqual(found['looks'][0]['preset'], 'mist')
        self.assertEqual(found['summary'], 'Quiet morning.')
        sent = self.seen[0]
        self.assertEqual(sent['model'], 'eyes-model')
        parts = sent['messages'][1]['content']
        self.assertEqual(sum(part['type'] == 'image_url' for part in parts), 3)
        self.assertIn('a quiet morning', parts[0]['text'])
        self.assertIn('settings_range', parts[0]['text'])  # The catalogue, with each setting's range.
        ai_settings_service.save_settings(None, 'https://ai.example.com/v1', 'image-model', text_model='chat-model', vision_model='')
        director.ask({}, frames)
        self.assertEqual(self.seen[-1]['model'], 'chat-model')  # No vision model: the text model.


class Facts(unittest.TestCase):
    def test_kanaa_sees_the_sky_and_the_sun_itself(self):
        frame = np.full((288, 512, 3), 225, np.uint8); frame[60:68, 340:348] = (60, 150, 250); frame[150:] = (40, 110, 40)
        near = np.zeros((288, 512), np.float32); near[150:] = 0.5
        from app.services.media_probe import MediaFacts
        with patch.object(director, '_frames', return_value=[frame, frame, frame]), patch.object(director, 'make_depth_map', return_value=Path('d.mp4')), \
                patch.object(director, '_nearness', return_value=near), patch('app.services.time_freeze_service.find_people', return_value=np.zeros((288, 512), np.float32)):
            found, frames = director.study(MediaFacts(path=Path('c.mp4'), media_type='video', width=1920, height=1080), 0, 4)
        self.assertAlmostEqual(found['sky_share'], 150 / 288, delta=0.05)
        self.assertAlmostEqual(found['horizon_from_top'], 150 / 288, delta=0.05)
        self.assertAlmostEqual(found['sun_or_bright_spot']['x'], 344 / 512, delta=0.03)
        self.assertEqual(found['people_share'], 0.0)
        self.assertEqual(len(frames), 3)


if __name__ == '__main__':
    unittest.main()
