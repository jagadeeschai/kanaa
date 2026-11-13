import unittest

from app.services.timeline_schema import Timeline
from kanaa_mcp import signature_titles as st

ROLES = [['பாடல் வரிகள்', 'Lyrics', 'பாவேந்தர் பாரதிதாசன்', 'Bharathidasan'], ['இசை & குரல்', 'Music & Vocals', 'AI (Suno)']]


class Titles(unittest.TestCase):
    def test_the_song_name_is_in_titles_that_follow_a_rename(self):
        t = {'format': {'width': 1920, 'height': 1080, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 300, 'speed': 1}]}]}
        st.card(t, 5.5, 6, 'கற்கண்டு', 'Karkandu', ROLES)
        st.credit_in_song(t, [50, 200], 'கற்கண்டு', 'Karkandu', ROLES, 'கவின்தமிழ் Originals')
        st.end_card(t, 270, 284, 'கற்கண்டு', 'Karkandu', ROLES, '℗ 2026')
        Timeline.model_validate(t)
        blocks = [i for l in t['layers'] for i in l['items'] if i['id'] in ('signature-song', 'credit-song-end')]
        self.assertEqual(len(blocks), 2, 'one title each for the card and the end card')
        self.assertIn('பாவேந்தர் பாரதிதாசன்\nBharathidasan', blocks[0]['text'], 'the English name on a small line under the Tamil')
        self.assertGreater(st.rename(t, ('கற்கண்டு', 'Karkandu'), ('நிலவே', 'Nilave')), 3)
        texts = [i['text'] for l in t['layers'] for i in l['items'] if i['id'].startswith(st.SONG_IDS)]
        self.assertTrue(texts and all('நிலவே' in text for text in texts))
