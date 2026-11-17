"""A vertical Short of a stretch of a lyric video: cut, filled to 9:16 on its subject, faded, and exported on the GPU."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

from app.services.media_probe import MediaFacts
from app.services.shorts import HEIGHT, LONGEST, WIDTH, make_short, short_range
from app.services.timeline_schema import Timeline

REST = {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0}
SCENE = MediaFacts(path=Path('scene.png'), media_type='image', width=1600, height=1000)


def song_video() -> Timeline:
    return Timeline.model_validate({'format': {'width': 1920, 'height': 1080, 'fps': 30}, 'layers': [
        {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [
            {'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 12, 'transform': {**REST, 'keyframes': {'x': [{'t': 0, 'v': .45}, {'t': 12, 'v': .55}], 'scale': [{'t': 0, 'v': 1}, {'t': 12, 'v': 1.2}]}}},
            {'id': 'b', 'media_id': 1, 'start': 12, 'in': 0, 'out': 30, 'transition_in': {'kind': 'crossfade', 'duration': .8}}]},
        {'id': 'fx', 'kind': 'video', 'name': 'Effects', 'blend': 'screen', 'items': [{'id': 'beat-light-1', 'media_id': 2, 'start': 14, 'in': 2.15, 'out': 3.35}]},
        {'id': 'song', 'kind': 'audio', 'name': 'Song', 'items': [{'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 42, 'source_length': 42}]},
        {'id': 'lyrics', 'kind': 'text', 'name': 'Lyrics', 'items': [
            {'id': 'c1', 'start': 9, 'length': 4, 'text': 'நிலவே நீ வா', 'karaoke': {'words': [0.5, 1.5, 2.5]}, 'enter': {'preset': 'word-pop', 'duration': .6}},
            {'id': 'c2', 'start': 13, 'length': 4, 'text': 'என் உயிரே வா'}, {'id': 'late', 'start': 40, 'length': 2, 'text': 'முடிவு'}]}]})


MEDIA = {1: SCENE, 2: MediaFacts(path=Path('burn.mp4'), media_type='video', width=1152, height=720, duration=5)}


class ShortTimeline(unittest.TestCase):
    def short(self, start=10, end=25, focus=(0.8, 0.4)):
        return make_short(song_video(), start, end, MEDIA.__getitem__, lambda facts, at: focus)

    def test_the_stretch_starts_at_zero_and_ends_on_time(self):
        short = self.short()
        self.assertEqual((short.format.width, short.format.height), (WIDTH, HEIGHT))
        self.assertAlmostEqual(short.duration, 15, places=3)
        line = short.layers[3].items[0]
        self.assertEqual((line.start, line.length), (0, 3))
        self.assertEqual(line.karaoke.words, [0, 0.5, 1.5], 'words sung after the cut keep their times')
        self.assertEqual([item.id for item in short.layers[3].items], ['c1', 'c2'], 'later lines are left out')
        b = short.layers[0].items[1]
        self.assertIsNone(short.layers[0].items[0].transition_in)
        self.assertAlmostEqual(b.start + (b.out - b.in_), 15, places=3)

    def test_pictures_fill_the_portrait_frame_on_their_subject(self):
        short = self.short()
        clip = short.layers[0].items[1]
        # A 16:10 picture fitted in 9:16 is a band 1080 wide: 1.92 / 0.675 times as big fills the height.
        self.assertAlmostEqual(clip.transform.scale, 1.92 / 0.675, places=3)
        self.assertLess(clip.transform.x, 0.5, 'moved left so the subject on the right comes to the middle')
        share, least = 1.0, 1.92 / 0.675
        self.assertLessEqual(abs(clip.transform.x - 0.5), (least * share - 1) / 2 + 1e-6, 'no edge shows')
        first = short.layers[0].items[0]
        self.assertNotIn('x', first.transform.keyframes, 'the wide pan gives way to the subject')
        self.assertGreater(first.transform.keyframes['scale'][-1].v, first.transform.keyframes['scale'][0].v, 'the zoom stays')

    def test_the_song_fades_in_and_out(self):
        sound = self.short().layers[2].items[0]
        self.assertGreater(sound.fade_in, 0)
        self.assertGreater(sound.fade_out, 1)

    def test_a_short_is_at_most_a_minute(self):
        self.assertEqual(short_range(5, 200, 300), (5, 5 + LONGEST))
        self.assertEqual(short_range(5, 6, 300), (5, 10))


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class ShortExport(unittest.TestCase):
    def test_it_exports_portrait_with_the_subject_in_the_middle(self):
        from app.services import gpu_render
        from app.services.timeline_service import render_timeline
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            picture = Image.new('RGB', (1600, 1000), (25, 35, 55))
            ImageDraw.Draw(picture).ellipse((1180, 330, 1380, 530), fill=(250, 200, 110))
            picture.save(root / 'scene.png')
            facts = {1: MediaFacts(path=root / 'scene.png', media_type='image', width=1600, height=1000)}
            timeline = Timeline.model_validate({'format': {'width': 1920, 'height': 1080, 'fps': 30}, 'layers': [
                {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 8}]}]})
            short = make_short(timeline, 2, 7, facts.__getitem__, lambda f, at: (1280 / 1600, 430 / 1000))
            self.assertEqual(gpu_render.unsupported(short, facts.__getitem__), [])
            target = root / 'short.mp4'
            with patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
                render_timeline(short, facts.__getitem__, lambda a: a, target, lambda _: None, hardware=False)
            probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0', str(target)], capture_output=True, text=True, check=True).stdout.split()
            self.assertEqual(probe[0], '1080,1920')
            self.assertAlmostEqual(float(probe[1]), 5, delta=0.1)
            frame = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout, np.uint8).reshape(1920, 1080, 3)
            bright = np.nonzero((frame[..., 0] > 200).any(axis=0))[0]
            self.assertTrue(bright.size)
            self.assertLess(abs((bright.min() + bright.max()) / 2 - 540), 1080 * .2, 'the subject is near the middle')
            self.assertGreater(frame[:40].mean(), 10, 'the picture fills the top: no black bands')


if __name__ == '__main__':
    unittest.main()
