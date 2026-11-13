"""Parallel export: where it cuts, that slices are exact, and that the joined video matches one made as a whole."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.services import parallel_export, render_window
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Timeline
from app.services.timeline_service import render_timeline

FPS = 30


def clip(cid, media, start, length, **extra):
    return {'id': cid, 'media_id': media, 'start': start, 'in': 0, 'out': length, **extra}


def song_timeline(seconds=90.0, transitions=True):
    """Pictures one after another (some with moves and crossfades), a karaoke title across them, and a song."""
    items, at, k = [], 0.0, 0
    while at < seconds - 0.01:
        length = min(11.0, seconds - at)
        extra = {'transform': {'x': 0.5, 'y': 0.5, 'scale': 1.1, 'keyframes': {'x': [{'t': 0, 'v': 0.45}, {'t': length, 'v': 0.55}]}}}
        if transitions and k:
            extra['transition_in'] = {'kind': 'crossfade', 'duration': 0.8}
        items.append(clip(f'c{k}', 1 + k % 3, round(at, 6), round(length, 6), **extra))
        at += length
        k += 1
    titles = [{'id': f't{n}', 'start': 3 + n * 9, 'length': 8, 'text': f'line {n} words here', 'style': 'outline',
               'enter': {'preset': 'fade', 'duration': 0.5}, 'karaoke': {'words': [0, 2, 4, 6]}} for n in range(int(seconds // 9) - 1)]
    return Timeline.model_validate({'format': {'width': 426, 'height': 240, 'fps': FPS}, 'layers': [
        {'id': 'main', 'kind': 'video', 'items': items},
        {'id': 'words', 'kind': 'text', 'items': titles},
        {'id': 'song', 'kind': 'audio', 'items': [{'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': seconds}]}]})


class PlanTests(unittest.TestCase):
    def test_short_exports_stay_whole(self):
        self.assertEqual(parallel_export.plan(song_timeline(60)), [])

    def test_cuts_are_on_frames_and_away_from_transitions_and_entrances(self):
        timeline = song_timeline(200)
        cuts = parallel_export.plan(timeline)
        self.assertGreaterEqual(len(cuts), 3)
        for at in cuts:
            self.assertAlmostEqual(at * FPS, round(at * FPS), places=4)
            for layer in timeline.layers:
                for item in layer.items:
                    data = item.model_dump(by_alias=True)
                    if data.get('transition_in'):
                        self.assertGreaterEqual(abs(at - data['start']), 0.8)
                    if data.get('enter') and data['start'] < at:
                        self.assertGreaterEqual(at - data['start'], 0.5)

    def test_a_clip_that_needs_earlier_frames_is_never_cut(self):
        data = song_timeline(200, transitions=False).model_dump(by_alias=True, mode='json')
        data['layers'][0]['items'] = [clip('long', 1, 0, 200, echo={'mode': 'echo'})]
        self.assertEqual(parallel_export.plan(Timeline.model_validate(data)), [])

    def test_slices_cover_everything_once(self):
        timeline = song_timeline(200)
        parts = parallel_export.slices(timeline, parallel_export.plan(timeline))
        self.assertIsNotNone(parts)
        self.assertEqual(parts[0][0], 0)
        self.assertAlmostEqual(parts[-1][1], timeline.duration)
        for (_, end, _), (start, _, _) in zip(parts, parts[1:]):
            self.assertEqual(end, start)
        for start, end, part in parts:  # Each slice has only what shows in it.
            self.assertLessEqual(len(part.layers[0].items), 5)

    def test_cut_exact_refuses_instead_of_using_the_whole(self):
        data = song_timeline(100).model_dump(by_alias=True, mode='json')
        data['layers'][0]['items'][0]['ramp'] = [{'t': 0, 'v': 1}, {'t': 1, 'v': 1}]
        self.assertIsNone(render_window.cut_exact(Timeline.model_validate(data), 5, 50))

    def test_first_slice_leaves_out_later_items(self):
        part = render_window.cut_exact(song_timeline(100), 0, 20)
        self.assertEqual([item.id for item in part.layers[0].items], ['c0', 'c1'])


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class JoinedMatchesWhole(unittest.TestCase):
    """The real thing: an export made in slices against the same export made as one graph."""

    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp())
        cls.facts = {}
        for n, source in enumerate(['testsrc2=s=640x360', 'smptebars=s=640x360', 'mandelbrot=s=640x360'], start=1):
            path = cls.root / f'p{n}.png'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', source, '-frames:v', '1', str(path)], check=True)
            cls.facts[n] = MediaFacts(path=path, media_type='image', width=640, height=360)
        cls.song = cls.root / 'song.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=90', '-ar', '48000', str(cls.song)], check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def export(self, name, parallel):
        target = self.root / name
        with mock.patch.dict(os.environ, {'KANAA_PARALLEL_EXPORT': '1' if parallel else '0'}):
            render_timeline(song_timeline(90), self.facts.__getitem__, lambda _: self.song, target, lambda _: None, hardware=False)
        return target

    def probe(self, path, entries):
        out = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries', entries, '-of', 'json', str(path)], capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    def test_same_frames_sound_and_length(self):
        whole, sliced = self.export('whole.mp4', False), self.export('sliced.mp4', True)
        a = self.probe(whole, 'stream=codec_type,nb_read_frames,duration')['streams']
        b = self.probe(sliced, 'stream=codec_type,nb_read_frames,duration')['streams']
        video = lambda streams: next(s for s in streams if s['codec_type'] == 'video')
        audio = lambda streams: next(s for s in streams if s['codec_type'] == 'audio')
        self.assertEqual(video(a)['nb_read_frames'], video(b)['nb_read_frames'])  # Not a frame lost or doubled.
        self.assertAlmostEqual(float(audio(a)['duration']), float(audio(b)['duration']), delta=0.05)
        # Every frame compared: the worst should differ only by encoding noise.
        log = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(whole), '-i', str(sliced), '-lavfi', 'psnr=stats_file=-', '-f', 'null', '-'],
                             capture_output=True, text=True).stdout
        values = [float(v) for v in re.findall(r'psnr_avg:([0-9.]+|inf)', log) if v != 'inf']
        self.assertTrue(values)
        print(f'\nPSNR worst {min(values):.1f} dB, average {sum(values) / len(values):.1f} dB over {len(values)} frames')
        self.assertGreater(min(values), 30, f'worst frame {min(values):.1f} dB')


if __name__ == '__main__':
    unittest.main()
