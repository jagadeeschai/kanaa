"""Lyric videos through the MCP server: reading LRC files, and the finished timeline (built by the lyric screen's own
code, then dressed with entrances, light, camera moves, film credits and a logo) passing Kanaa's timeline rules."""
import shutil
import unittest

from kanaa_mcp import lyrics
from app.services.timeline_schema import Timeline

LRC = """[00:00.83][Free flowing opening, no drums]
[00:00.83]வா வா வெண்ணிலவே…
[00:06.75]வா வா வெண்ணிலவே…
[00:12.27][Chorus – male Lead]
[00:12.27]மறைந்தோடப் பிறந்தாயென் விருந்தாளியே!
[00:20.00]நற்செய்தி சொல்லுவே
[00:21.10]னே
[00:30.00]கலைவெள்ளமே!
"""


class ReadLrc(unittest.TestCase):
    def test_lines_without_directions_and_a_split_word_joined(self):
        cues = lyrics.read_lrc(LRC)
        self.assertEqual([cue['text'] for cue in cues], ['வா வா வெண்ணிலவே…', 'வா வா வெண்ணிலவே…', 'மறைந்தோடப் பிறந்தாயென் விருந்தாளியே!', 'நற்செய்தி சொல்லுவேனே', 'கலைவெள்ளமே!'])
        self.assertEqual(cues[0]['start'], 0.83)
        self.assertAlmostEqual(cues[0]['end'], 6.7)
        self.assertLessEqual(cues[2]['end'] - cues[2]['start'], 7, 'no line lasts past the longest')
        self.assertAlmostEqual(cues[-1]['end'], 34.0, places=1)


@unittest.skipUnless(shutil.which('node'), 'node builds the lyric screen timeline')
class Build(unittest.TestCase):
    def timeline(self, three_d=True):
        cues = lyrics.read_lrc(LRC)
        return lyrics.base_timeline({'name': 'வா வா வெண்ணிலவே', 'backgrounds': [{'id': 1, 'media_type': 'image'}, {'id': 2, 'media_type': 'image'}], 'backgroundType': 'image',
                                     'duration': 40, 'slideStarts': [0, 20], 'song': {'id': 'a' * 32, 'duration': 40, 'name': 'song'}, 'cues': cues, 'canvas': 'landscape',
                                     'color': '#ffffff', 'fontSize': 50, 'placement': 'bottom', 'lyricStyle': 'shadow', 'lyricFont': 'elegant', 'lyricAlign': 'center',
                                     'lyricBandColor': '#000', 'lyricAnimation': 'cinematic', 'crossfade': True, 'imageAnimation': '3d' if three_d else 'ken-burns',
                                     'depthVideos': {1: 11, 2: 12} if three_d else None, 'inScene': three_d})

    def test_a_finished_lyric_video_keeps_to_kanaas_rules(self):
        t = self.timeline()
        lyrics.lay_out(t)
        lyrics.dress(t, 'romantic', {'fireflies': 50, 'bokeh': 51})
        lyrics.credits(t, 'வா வா வெண்ணிலவே', 'KAVIN TAMIL ORIGINALS', 'பட்டுக்கோட்டை கல்யாணசுந்தரம்', 'Made with Suno', 'கவின்தமிழ் Originals',
                       'Lyric video with Kanaa', '#cfc8ff', {'media_id': 9, 'width': 1536, 'height': 1024})
        Timeline.model_validate(t)
        names = [layer.get('name') for layer in t['layers']]
        self.assertEqual(names[:2], ['Main', 'Effects'])
        self.assertIn('In front', names)
        self.assertEqual(names[-1], 'Brand')
        line = next(item for layer in t['layers'] if layer['kind'] == 'text' for item in layer['items'] if item['id'] == 'lyric-line-1')
        self.assertEqual(line['enter']['preset'], 'rise-behind')
        self.assertGreater(line['depth']['amount'], 0, '3D letters kept')
        self.assertGreaterEqual(line['start'], lyrics.OPENING, 'the song starts after the opening cards')
        scene = next(clip for clip in t['layers'][0]['items'] if clip['id'] == 'lyric-scene-1')
        front = next(layer for layer in t['layers'] if layer.get('name') == 'In front')['items'][0]
        self.assertEqual(front['transform'], scene['transform'], 'the in-front copy moves with its scene')
        self.assertEqual(front['start'], scene['start'])
        texts = [item for layer in t['layers'] if layer['kind'] == 'text' for item in layer['items']]
        self.assertIn('A SONG BY', [item.get('subtitle') for item in texts])
        tamil_labels = [item for item in texts if item.get('subtitle') and not item['subtitle'].isascii()]
        self.assertTrue(all(item.get('subtitle_spacing', 0) == 0 for item in tamil_labels), 'Tamil is never letter-spaced')

    def test_without_3d_or_credits_it_still_keeps_to_the_rules(self):
        t = self.timeline(three_d=False)
        lyrics.lay_out(t)
        lyrics.dress(t, 'energetic', {})
        lyrics.credits(t, 'Song', None, None, None, None, None, '#e8b04a', None)
        Timeline.model_validate(t)
        self.assertNotIn('Brand', [layer.get('name') for layer in t['layers']])


if __name__ == '__main__':
    unittest.main()
