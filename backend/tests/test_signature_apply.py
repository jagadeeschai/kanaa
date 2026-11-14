"""A saved signature put into another song from the editor: same card and credits, only the song's name new."""
import tempfile
import unittest
from pathlib import Path

from app.services import signature_apply
from kanaa_mcp import signature

ROLES = [['பாடல் வரிகள்', 'Lyrics', 'பாவேந்தர் பாரதிதாசன்', 'Bharathidasan'], ['இசை & குரல்', 'Music & Vocals', 'AI (Suno)']]


def song():
    clip = lambda id_, start, length: {'id': id_, 'media_id': 5, 'start': start, 'in': 0, 'out': length}
    return {'version': 2, 'format': {'width': 1920, 'height': 1080, 'fps': 30}, 'layers': [
        {'id': 'main', 'kind': 'video', 'items': [clip('brand-intro-1', 0, 5.5), clip('scene-1', 5.5, 60), clip('scene-2', 65.5, 20)]},
        {'id': 'lyric-titles', 'kind': 'text', 'items': [{'id': 'lyric-line-1', 'start': 10, 'length': 4, 'text': 'வரி'}, {'id': 'lyric-line-2', 'start': 70, 'length': 4, 'text': 'வரி'}]}]}


class ApplySignature(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        signature.save(self.folder, 'பாவேந்தர் பாரதிதாசன்', {'lyricist': 'பாவேந்தர் பாரதிதாசன்', 'lyricist_english': 'Bharathidasan', 'portrait': 2, 'paper': 3,
                                                       'cards': {'picture': 291}, 'roles': ROLES, 'rights': '℗ 2026'})

    def test_card_after_the_intro_and_the_song_moves_later(self):
        out = signature_apply.apply(song(), self.folder, 'பாவேந்தர் பாரதிதாசன்', 'தேன்மொழி', 'Thenmozhi')
        main = {clip['id']: clip for clip in out['layers'][0]['items']}
        self.assertEqual((main['signature-paper']['start'], main['signature-paper']['media_id']), (5.5, 291))
        self.assertEqual(main['brand-intro-1']['start'], 0)
        self.assertEqual(main['scene-1']['start'], 11.5)
        words = {item['id']: item for layer in out['layers'] if layer['kind'] == 'text' for item in layer['items']}
        self.assertEqual(words['lyric-line-1']['start'], 16)
        self.assertTrue(words['signature-song']['text'].startswith('தேன்மொழி\nTHENMOZHI'))
        self.assertIn('Bharathidasan', words['signature-song']['text'])  # The credits stay as saved.
        self.assertGreater(words['credit-song-end']['start'], words['lyric-line-2']['start'] + 4)

    def test_adding_again_replaces_rather_than_doubling(self):
        once = signature_apply.apply(song(), self.folder, 'பாவேந்தர் பாரதிதாசன்', 'தேன்மொழி', 'Thenmozhi')
        twice = signature_apply.apply(once, self.folder, 'பாவேந்தர் பாரதிதாசன்', 'கற்கண்டு', 'Karkandu')
        main = {clip['id']: clip for clip in twice['layers'][0]['items']}
        self.assertEqual(main['scene-1']['start'], 11.5)
        self.assertEqual(sum(clip['id'] == 'signature-paper' for clip in twice['layers'][0]['items']), 1)

    def test_unknown_signature(self):
        with self.assertRaises(LookupError):
            signature_apply.apply(song(), self.folder, 'nobody', 'x', '')


if __name__ == '__main__':
    unittest.main()
