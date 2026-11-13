import unittest

from app.services.timeline_schema import Timeline
from kanaa_mcp import signature_credits


class Place(unittest.TestCase):
    def test_pictures_replace_the_text_credits_and_never_meet_the_lyrics(self):
        timeline = {'format': {'width': 1920, 'height': 1080, 'fps': 30}, 'layers': [
            {'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 300, 'speed': 1}]},
            {'id': 'lyric-titles', 'kind': 'text', 'items': [{'id': 'clip-x', 'start': 270, 'length': 7, 'text': 'x', 'style': 'shadow', 'position': 'center', 'color': '#ffffff', 'size': 40}]},
            {'id': 'credits-ticker', 'kind': 'text', 'items': []}, {'id': 'credits-end-1', 'kind': 'text', 'items': []}]}
        signature_credits.place(timeline, [43, 190], 277.0, 5, 6, 7, 8)
        Timeline.model_validate(timeline)
        ids = {layer['id'] for layer in timeline['layers']}
        self.assertFalse({'credits-ticker', 'credits-end-1'} & ids)
        art = {clip['id']: clip for layer in timeline['layers'] if layer['id'] == 'credits-portraits' for clip in layer['items']}
        self.assertGreaterEqual(art['credit-end-card']['start'], 277.0, 'the end card waits for the last lyric')
        self.assertAlmostEqual(art['credit-production']['start'], 295.2, places=3)
        self.assertEqual(sorted(k for k in art if k.startswith('credit-lower')), ['credit-lower-1', 'credit-lower-2'])
