import tempfile
import unittest

from app.services.timeline_schema import Timeline
from pathlib import Path

from kanaa_mcp import signature

SIG = {'portrait': 7, 'paper': 8, 'presented_by': 'கவின்தமிழ் Originals', 'lyricist': 'பாவேந்தர் பாரதிதாசன்'}


def song():
    return {'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'brand-intro', 'start': 0, 'in': 0, 'out': 5.5, 'speed': 1},
                                                                    {'id': 'lyric-scene-1', 'start': 5.5, 'in': 0, 'out': 100, 'speed': 1}]},
                       {'id': 'song', 'kind': 'audio', 'items': [{'id': 'song', 'start': 5.5, 'in': 0, 'out': 100, 'speed': 1}]},
                       {'id': 'L', 'kind': 'text', 'items': [{'id': 'lyric-line-1', 'start': 35, 'length': 3, 'text': 'x'}]}]}


class Card(unittest.TestCase):
    def test_the_card_opens_in_silence_and_everything_after_moves_later(self):
        timeline = song()
        at = signature.add_card(timeline, 'கற்கண்டு', 'Karkandu', SIG, [['பாடல் வரிகள்', 'Lyrics', 'பாவேந்தர் பாரதிதாசன்']])
        self.assertEqual(at, 5.5)
        for layer in timeline['layers']:
            items = sorted(layer['items'], key=lambda item: item['start'])
            for a, b in zip(items, items[1:]):
                self.assertLessEqual(a['start'] + a.get('length', (a.get('out', 0) - a.get('in', 0))), b['start'] + 1e-6, f"items overlap on {layer['id']}")
        from app.services.timeline_schema import Text
        for layer in timeline['layers']:
            for item in layer['items'] if layer['kind'] == 'text' else []:
                Text.model_validate(item)
        self.assertIn('பாவேந்தர் பாரதிதாசன்', [layer['items'][0]['text'] for layer in timeline['layers'] if layer['id'].startswith('signature-words')], 'his name under the portrait')
        main = timeline['layers'][0]['items']
        self.assertEqual([c['id'] for c in main], ['brand-intro', 'signature-paper', 'lyric-scene-1'])
        song_start = next(l for l in timeline['layers'] if l['kind'] == 'audio')['items'][0]['start']
        self.assertEqual(song_start, 11.5, 'the music waits for the card')
        self.assertEqual(next(l for l in timeline['layers'] if l['id'] == 'L')['items'][0]['start'], 41)
        signature.add_card(timeline, 'கற்கண்டு', 'Karkandu', SIG, [['பாடல் வரிகள்', 'Lyrics', 'x']])
        self.assertEqual(next(l for l in timeline['layers'] if l['kind'] == 'audio')['items'][0]['start'], 11.5, 'made again, not moved twice')

    def test_a_typeset_card_is_the_whole_card(self):
        timeline = song()
        signature.add_card(timeline, 'கற்கண்டு', 'Karkandu', SIG, [['பாடல் வரிகள்', 'Lyrics', 'x']], card=42)
        self.assertEqual(next(c for c in timeline['layers'][0]['items'] if c['id'] == 'signature-paper')['media_id'], 42)
        self.assertFalse([l for l in timeline['layers'] if l['id'].startswith(('signature-words', 'signature-portrait'))], 'its words and portrait are in the card itself')

    def test_a_signature_is_kept_for_the_next_song(self):
        with tempfile.TemporaryDirectory() as folder:
            signature.save(Path(folder), 'பாவேந்தர் பாரதிதாசன்', SIG)
            self.assertEqual(signature.load(Path(folder), 'பாவேந்தர் பாரதிதாசன்')['portrait'], 7)
            self.assertIsNone(signature.load(Path(folder), 'someone else'))
