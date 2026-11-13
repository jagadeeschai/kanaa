import unittest

from kanaa_mcp import song_details


def line(at, length=3.0):
    return {'id': f'lyric-line-{at}', 'start': at, 'length': length, 'text': 'x'}


class Card(unittest.TestCase):
    def test_only_named_roles_show_in_tamil_and_english(self):
        text = song_details.lines({'music': 'Suno', 'arrangement': 'KavinTamil Originals', 'lyrics': ' ', 'singers': None})
        self.assertEqual(text, 'இசை · Music  Suno\nஇசையமைப்பு & பாணி · Arrangement & style  KavinTamil Originals')

    def test_it_shows_when_the_singing_starts_and_after_the_break(self):
        timeline = {'layers': [{'id': 'main', 'kind': 'video', 'items': []}, {'id': 'L', 'kind': 'text', 'items': [line(35), line(40), line(45), line(120), line(125)]}]}
        self.assertEqual(song_details.add(timeline, 'கற்கண்டு', {'music': 'Suno'}), 2)
        card = timeline['layers'][-1]['items']
        self.assertEqual([item['start'] for item in card], [35, 120])
        self.assertEqual(card[0]['text'], 'கற்கண்டு')
        self.assertEqual(song_details.add(timeline, 'x', {}), 0, 'no names, no card')
