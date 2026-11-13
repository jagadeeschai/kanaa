import unittest

from app.services.timeline_schema import Timeline

from kanaa_mcp import credit_package

ROLES = [('பாடல் வரிகள்', 'Lyrics', 'பாவேந்தர் பாரதிதாசன்'), ('இசை & குரல்', 'Music & Vocals', 'AI (Suno)'), ('இசை வடிவமைப்பு', 'Arrangement & Style', 'KavinTamil Originals'),
         ('தயாரிப்பு', 'Produced by', 'கவின்தமிழ் Originals')]


def song():
    lines = [{'id': f'lyric-line-{n}', 'start': at, 'length': 4, 'text': 'x'} for n, at in enumerate([35, 40, 45, 50, 120, 125, 200, 205, 260])]
    return {'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'brand-intro', 'start': 0, 'in': 0, 'out': 5.5, 'speed': 1}, {'id': 'lyric-scene-1', 'start': 5.5, 'in': 0, 'out': 277.3, 'speed': 1}]},
                       {'id': 'L', 'kind': 'text', 'items': lines}, {'id': 'T', 'kind': 'text', 'items': [{'id': 'house-title', 'start': 24.5, 'length': 10.5, 'text': 'x'}]}]}


class Package(unittest.TestCase):
    def test_opening_ticker_and_end_card_keep_out_of_the_way(self):
        timeline = song()
        when = credit_package.add(timeline, 'கற்கண்டு', 'Karkandu', ROLES, 'கற்கண்டு • பாடல் வரிகள்: பாவேந்தர் பாரதிதாசன்', rights='℗ 2026 கவின்தமிழ் Originals', portrait=(9, 0))
        start, finish = when['opening']
        self.assertGreater(start, 5.5, 'after the brand intro')
        self.assertLess(finish, 24.5, 'gone before the title card and the singing')
        self.assertEqual(len(when['ticker']), 3)
        for layer in timeline['layers']:
            items = sorted(layer['items'], key=lambda item: item['start'])
            for a, b in zip(items, items[1:]):
                self.assertLessEqual(a['start'] + a.get('length', 0), b['start'] + 1e-6, f"items overlap on {layer['id']}")
        from app.services.timeline_schema import Text
        for layer in timeline['layers']:
            for item in layer['items'] if layer['kind'] == 'text' else []:
                Text.model_validate(item)
        layers = {layer['id']: layer for layer in timeline['layers']}
        self.assertTrue(all(item['transform']['y'] > 0.9 for item in layers['credits-ticker']['items']), 'the ticker runs along the bottom')
        self.assertTrue(all(layer['items'][0]['transform']['x'] < 0.4 for key, layer in layers.items() if key.startswith('credits-end')), 'the end card keeps the right side free')
        self.assertEqual(when['end'][1], 282.8)
        self.assertGreater(when['end'][0], 264, 'after the singing')
        self.assertNotIn('band_color', layers['credits-opening-1']['items'][0], 'no boxes behind the words')
        portraits = layers['credits-portraits']['items']
        self.assertEqual([p['media_id'] for p in portraits], [9, 9], 'the lyricist\'s portrait on the opening and end cards')
        self.assertLess(portraits[0]['transform']['scale'], 0.1, 'smaller than a passport photo')
