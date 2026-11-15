"""Building label-style credits must not discard lyrics sharing the old credit layer."""
import shutil
import unittest
from unittest.mock import Mock

from kanaa_mcp.lyric_builder import build_lyric_video
from app.services.timeline_schema import Timeline


@unittest.skipUnless(shutil.which('node'), 'node builds the lyric timeline')
class CreditReplacement(unittest.TestCase):
    def build(self, song_details=True, song_by='Poet'):
        api = Mock()
        api.post.return_value = {'id': 42}
        media = Mock(return_value={'width': 640, 'height': 360})
        result = build_lyric_video(api, media, Mock(), Mock(), Mock(), Mock(), Mock(),
                                  name='Song', song_asset_id='a'*32, song_seconds=30,
                                  cues=[{'text': 'First lyric', 'start': 1, 'end': 6}, {'text': 'Second lyric', 'start': 12, 'end': 18}],
                                  scenes=[{'media_id': 1, 'start': 0}], lyric_motion='plain',
                                  lights=False, shots=False, night_sky=False, lamp_glow=False,
                                  song_details=song_details, song_by=song_by, music='Composer')
        recipe = api.put.call_args.args[1]['recipe']
        Timeline.model_validate(recipe)
        return recipe, result

    def test_label_credits_keep_every_lyric_on_the_shared_layer(self):
        recipe, result = self.build()
        text = [item for layer in recipe['layers'] if layer['kind'] == 'text' for item in layer['items']]
        lyrics = [item for item in text if item['id'].startswith('lyric-line-')]
        self.assertEqual([item['text'] for item in lyrics], ['First lyric', 'Second lyric'])
        self.assertFalse(any(item['id'].startswith(('opening-', 'closing-')) for item in text))
        self.assertTrue(any(layer['id'].startswith('credits-opening') for layer in recipe['layers']))
        self.assertEqual(result['project_id'], 42)

    def test_film_credits_still_keep_the_lyrics_when_label_credits_are_off(self):
        recipe, _ = self.build(song_details=False)
        ids = [item['id'] for layer in recipe['layers'] if layer['kind'] == 'text' for item in layer['items']]
        self.assertEqual(sum(id.startswith('lyric-line-') for id in ids), 2)
        self.assertIn('opening-3', ids)
