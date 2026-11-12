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

    def test_house_style_keeps_to_kanaas_rules_and_answers_line_by_line(self):
        t = self.timeline(three_d=False)
        lyrics.lay_out(t)
        lyrics.dress(t, 'romantic', {'fireflies': 50, 'bokeh': 51})
        lyrics.credits(t, 'எனைத் தொட்டிழுத்தாள்!', None, 'பாவேந்தர் பாரதிதாசன்', None, None, None, '#e8b04a', None)
        lyrics.house_style(t, 'எனைத் தொட்டிழுத்தாள்!', 'பாவேந்தர் பாரதிதாசன்')
        Timeline.model_validate(t)
        names = [layer.get('name') for layer in t['layers']]
        self.assertIn('Lyrics (answer)', names)
        self.assertIn('Title', names)
        self.assertIn('Lower third', names)
        lines = sorted((item for layer in t['layers'] if layer['kind'] == 'text' for item in layer['items'] if item['id'].startswith('lyric-line-')), key=lambda item: item['start'])
        answer = next(layer for layer in t['layers'] if layer['id'] == 'lyrics-answer')
        self.assertEqual({item['id'] for item in answer['items']}, {line['id'] for line in lines[1::2]}, 'even lines answer on their own layer')
        first = lines[0]
        self.assertEqual((first['font'], first['size'], first['color'], first['enter']['preset']), ('Arima', 44, '#fff7e8', 'particle-form'))
        self.assertEqual(first['transform']['keyframes']['x'][0]['v'], 0.5, 'each line starts at the centre')
        self.assertEqual(first['transform']['x'], 0.72, 'odd lines go right')
        self.assertEqual(lines[1]['transform']['x'], 0.29, 'even lines go left')
        lower = next(layer for layer in t['layers'] if layer['id'] == 'house-lower')['items'][0]
        self.assertEqual(lower['subtitle'], 'பாவேந்தர் பாரதிதாசன்')
        scenes = [clip for clip in t['layers'][0]['items'] if clip['id'].startswith('lyric-scene-')]
        self.assertEqual(scenes[-1]['exit'], {'preset': 'fade', 'duration': 3.0}, 'the last scene leaves slowly')

    def test_without_3d_or_credits_it_still_keeps_to_the_rules(self):
        t = self.timeline(three_d=False)
        lyrics.lay_out(t)
        lyrics.dress(t, 'energetic', {})
        lyrics.credits(t, 'Song', None, None, None, None, None, '#e8b04a', None)
        Timeline.model_validate(t)
        self.assertNotIn('Brand', [layer.get('name') for layer in t['layers']])


if __name__ == '__main__':
    unittest.main()


@unittest.skipUnless(shutil.which('node'), 'node builds the lyric screen timeline')
class IntoTheClear(unittest.TestCase):
    def test_each_line_starts_behind_the_person_and_ends_in_the_clear_space(self):
        import numpy as np
        mask = np.zeros((1024, 1536), bool)
        mask[200:1000, 300:740] = True  # A singer on the left; the right is clear.
        space = lyrics.spaces(mask)
        self.assertEqual(len(space['people']), 1)
        self.assertGreater(space['clear'][0], 0.45)
        cues = lyrics.read_lrc(LRC)
        t = lyrics.base_timeline({'name': 'Song', 'backgrounds': [{'id': 1, 'media_type': 'image'}], 'backgroundType': 'image', 'duration': 40, 'slideStarts': [0],
                                  'song': {'id': 'a' * 32, 'duration': 40, 'name': 'song'}, 'cues': cues, 'canvas': 'landscape', 'color': '#ffffff', 'fontSize': 50,
                                  'placement': 'bottom', 'lyricStyle': 'shadow', 'lyricFont': 'elegant', 'lyricAlign': 'center', 'lyricBandColor': '#000000',
                                  'lyricAnimation': 'fade', 'crossfade': False, 'imageAnimation': '3d', 'depthVideos': {1: 7}, 'inScene': False})
        lyrics.lay_out(t)
        lyrics.into_clear(t, {'lyric-scene-1': {**space, 'size': [1536, 1024]}}, {'lyric-scene-1': 7})
        Timeline.model_validate(t)
        scene = next(c for c in t['layers'][0]['items'] if c['id'] == 'lyric-scene-1')
        self.assertNotIn('keyframes', scene['transform'], 'the scene holds still')
        lines = [i for l in t['layers'] if l['kind'] == 'text' for i in l['items'] if i['id'].startswith('lyric-line')]
        long = next(line for line in lines if line['text'].startswith('மறைந்தோட'))
        keys = long['transform']['keyframes']['x']
        self.assertLess(keys[0]['v'], 0.5, 'starts behind the singer')
        self.assertGreater(keys[-1]['v'], 0.6, 'ends in the clear space to the right')
        self.assertIn('\n', long['text'], 'a long line splits onto two')
        cover = next(l for l in t['layers'] if l.get('name') == 'Person')['items']
        self.assertEqual(len(cover), len(lines))
        self.assertTrue(all(c['out'] - c['in'] <= lyrics.COVER_SECONDS + 1e-6 for c in cover), 'people cover a line only while it moves clear')
        self.assertTrue(all(c['transform'] == scene['transform'] for c in cover), 'the cut-out lines up with its scene')


@unittest.skipUnless(shutil.which('node'), 'node builds the lyric screen timeline')
class WithBrandIntro(unittest.TestCase):
    def test_the_intro_opens_then_the_song_credit_and_title_then_the_song(self):
        t = Build().timeline(three_d=False)
        lyrics.lay_out(t)
        lyrics.credits(t, 'Song', 'KAVIN TAMIL ORIGINALS', 'பட்டுக்கோட்டை கல்யாணசுந்தரம்', 'Made with Suno', None, 'Lyric video with Kanaa', '#e8b04a', None)
        lyrics.prepend_intro(t, 99)
        Timeline.model_validate(t)
        main = t['layers'][0]['items']
        self.assertEqual((main[0]['id'], main[0]['start'], main[1]['start']), ('brand-intro', 0.0, 5.5))
        texts = {i['id']: i for l in t['layers'] if l['kind'] == 'text' for i in l['items']}
        self.assertNotIn('opening-1', texts, 'the intro says who presents')
        song = [i for l in t['layers'] if l['kind'] == 'audio' for i in l['items']][0]
        self.assertEqual(song['start'], 10.5)
        self.assertTrue(texts['opening-2']['start'] < texts['opening-3']['start'] < song['start'])


class FillFrame(unittest.TestCase):
    def test_a_3_2_picture_covers_a_16_9_frame_and_keeps_its_zoom(self):
        t = {'format': {'width': 1920, 'height': 1080, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [
            {'id': 'lyric-scene-1', 'media_id': 5, 'transform': {'x': 0.5, 'y': 0.5, 'scale': 1.07, 'keyframes': {'scale': [{'t': 0, 'v': 1.0}, {'t': 9, 'v': 1.1}]}}},
            {'id': 'brand-intro', 'media_id': 6, 'transform': {'x': 0.5, 'y': 0.5, 'scale': 1}}]}]}
        lyrics.fill_frame(t, {5: (1536, 1024), 6: (1280, 720)})
        scene, intro = t['layers'][0]['items']
        fill = (1920 / 1080) / (1536 / 1024)
        self.assertAlmostEqual(scene['transform']['keyframes']['scale'][0]['v'], fill, places=3)
        self.assertAlmostEqual(scene['transform']['keyframes']['scale'][1]['v'], 1.1 * fill, places=3)
        self.assertEqual(intro['transform']['scale'], 1, 'the brand intro is left as made')
