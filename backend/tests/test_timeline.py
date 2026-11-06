import io
import json
import math
import os
import re
import shutil
import sys
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.core.config import settings
from app.main import app
from app.services import asset_service, cutout_service, instance_service, voice_service, face_service, reverse_service, stabilise_service, render_queue_service, stem_service, tracking_service, transcript_service
from app.services.animation import LOOKS, chroma_yuv, look_at
from app.services.asset_service import make_proxy
from app.services.job_service import JobCancelled, get_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.timeline_schema import Chroma, Timeline, Transform, value_at
from app.services.video_edit_service import resolve_audio_asset
from app.services.timeline_service import render_text_image, atempo_chain, chroma_filters, property_expression, render_timeline, upgrade_edit_recipe
from app.services.video_service import _run_ffprobe

FFMPEG = shutil.which('ffmpeg')


# Stands in for the Vision helper: the 'person' is a circle in the middle of every frame.
FAKE_FINDER_CODE = '''
import sys
width, height = int(sys.argv[1]), int(sys.argv[2])
rows = [bytes(255 if (x - width / 2) ** 2 + (y - height / 2) ** 2 < (height / 3) ** 2 else 0 for x in range(width)) for y in range(height)]
mask = b''.join(rows)
while len(sys.stdin.buffer.read(width * height * 3)) == width * height * 3:
    sys.stdout.buffer.write(mask)
'''
FAKE_FINDER_FILE = Path(tempfile.gettempdir()) / 'kanaa-fake-person-finder.py'
FAKE_FINDER_FILE.write_text(FAKE_FINDER_CODE)
FAKE_FINDER = [sys.executable, str(FAKE_FINDER_FILE)]
# Stands in for the Vision instance helper: two circles, left and right, sent in a different order each frame, as Vision does.
FAKE_INSTANCES_CODE = '''
import sys
width, height = int(sys.argv[1]), int(sys.argv[2])
def circle(cx):
    return b''.join(bytes(255 if (x - cx) ** 2 + (y - height / 2) ** 2 < (height / 5) ** 2 else 0 for x in range(width)) for y in range(height))
left, right = circle(width / 4), circle(width * 3 / 4)
frame = 0
while len(sys.stdin.buffer.read(width * height * 3)) == width * height * 3:
    sys.stdout.buffer.write(bytes([2]) + (left + right if frame % 2 else right + left))
    frame += 1
'''
FAKE_INSTANCES_FILE = Path(tempfile.gettempdir()) / 'kanaa-fake-instance-finder.py'
FAKE_INSTANCES_FILE.write_text(FAKE_INSTANCES_CODE)
FAKE_INSTANCES = [sys.executable, str(FAKE_INSTANCES_FILE)]


def run(*args):
    subprocess.run([FFMPEG, '-v', 'error', '-y', *args], check=True, capture_output=True, timeout=60)


def make_clip(path, color, size, fps, tone=None, seconds=2.2, extra=()):
    args = ['-f', 'lavfi', '-i', f'color=c={color}:s={size}:r={fps}:d={seconds}']
    if tone:
        args += ['-f', 'lavfi', '-i', f'sine=frequency={tone}:sample_rate=48000', '-shortest', '-c:a', 'aac']
    run(*args, '-t', str(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', *extra, str(path))


class Clips(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        root = cls.root = Path(cls.fixture.name)
        make_clip(root / 'red.mp4', 'red', '640x360', 30, 300)
        make_clip(root / 'plain_green.mp4', 'green', '480x270', 24, 600)
        run('-display_rotation', '90', '-i', str(root / 'plain_green.mp4'), '-c', 'copy', str(root / 'green.mp4'))
        make_clip(root / 'blue.mp4', 'blue', '320x240', 25)
        make_clip(root / 'source_yellow.mp4', 'yellow', '640x360', 30, 900)
        run('-i', str(root / 'source_yellow.mp4'), '-vf', "select='not(mod(n,3))+lt(n,3)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'copy', str(root / 'yellow.mp4'))
        run('-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=30:d=2.2', '-c:v', 'libx265', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p10le',
            '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-tag:v', 'hvc1', str(root / 'hdr.mp4'))
        cls.facts = {index: probe_video(root / f'{name}.mp4') for index, name in enumerate(('red', 'green', 'blue', 'yellow', 'hdr'), start=1)}
        image = root / 'still.png'
        Image.new('RGB', (400, 400), (255, 0, 255)).save(image)
        cls.facts[6] = MediaFacts(path=image, media_type='image', width=400, height=400)

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.out = Path(self.folder.name)

    def tearDown(self):
        self.folder.cleanup()

    def render(self, data, name='out.mp4', **options):
        timeline = Timeline.model_validate(data)
        target = self.out / name
        render_timeline(timeline, self.facts.__getitem__, lambda asset: self.root / asset, target, lambda _: None, **options)
        return target

    def frame(self, path, number, size=(1280, 720)):
        w, h = size
        data = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-vf', f'select=eq(n\\,{number}),scale=in_color_matrix=bt709:in_range=tv', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                              capture_output=True, check=True, timeout=60)
        return np.frombuffer(data.stdout, dtype=np.uint8).reshape(h, w, 3).astype(int)

    def tone(self, path, start, seconds):
        """Main pitch and loudness of a slice. Decodes everything, so the slice is sample exact."""
        data = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True, timeout=30)
        samples = np.frombuffer(data.stdout, dtype=np.float32)[round(start * 16000):round((start + seconds) * 16000)]
        return (0, 0.0) if not len(samples) else (float(np.argmax(np.abs(np.fft.rfft(samples * np.hanning(len(samples))))) * 16000 / len(samples)), float(np.sqrt((samples ** 2).mean())))

    @staticmethod
    def video(path):
        return next(stream for stream in _run_ffprobe(path)['streams'] if stream['codec_type'] == 'video')

    @staticmethod
    def frame_count(path):
        return int(subprocess.run([shutil.which('ffprobe'), '-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout.strip().split(',')[0])



class FrameRates(Clips):
    def test_every_project_frame_rate_exports_at_that_rate_with_the_same_timing(self):
        for fps in (24, 25, 30, 50, 60):
            data = {'format': {'width': 426, 'height': 240, 'fps': fps}, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [
                {'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1},
                {'id': 'b', 'media_id': 3, 'start': 1, 'in': 0, 'out': 1, 'transition_in': {'kind': 'crossfade', 'duration': 0.4}}]}]}
            path = self.render(data, f'rate-{fps}.mp4')
            stream = self.video(path)
            self.assertEqual(stream['r_frame_rate'], f'{fps}/1', fps)
            self.assertEqual(self.frame_count(path), 2 * fps, fps)

class Join(Clips):
    FORMAT = {'width': 1280, 'height': 720, 'fps': 30}

    def clip(self, media_id, start, **extra):
        return {'id': f'c{media_id}-{start}', 'media_id': media_id, 'start': start, 'in': 0.5, 'out': 1.5, **extra}

    def test_mixed_sources_join_in_order_with_their_own_sound(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [self.clip(media, index) for index, media in enumerate((1, 2, 3, 4, 5))]}]}
        output = self.render(data)
        video = self.video(output)
        self.assertEqual((video['width'], video['height'], video['pix_fmt'], video['color_space'], video['color_transfer']), (1280, 720, 'yuv420p', 'bt709', 'bt709'))
        self.assertEqual(self.frame_count(output), 150)
        center = lambda number: self.frame(output, number)[340:380, 620:660].mean(axis=(0, 1))
        self.assertGreater(center(15)[0], 200)  # red
        self.assertGreater(center(45)[1], 100)  # green
        self.assertGreater(center(75)[2], 200)  # blue
        self.assertGreater(center(105)[0], 200); self.assertGreater(center(105)[1], 200)  # yellow
        self.assertLess(np.ptp(center(135)), 25)  # HDR gray stays neutral
        # Cuts land on the exact frame.
        self.assertGreater(center(29)[0], 200)
        self.assertGreater(center(30)[1], 100); self.assertLess(center(30)[0], 60)
        # The rotated phone clip stays upright and fits inside the frame, with black beside it.
        rotated = self.frame(output, 45)
        self.assertLess(rotated[360, 100].max(), 30)
        self.assertGreater(rotated[100:620, 640, 1].min(), 80)
        # Each clip keeps its own sound; the silent clip stays silent.
        self.assertAlmostEqual(self.tone(output, 0.2, 0.6)[0], 300, delta=10)
        self.assertAlmostEqual(self.tone(output, 1.2, 0.6)[0], 600, delta=10)
        self.assertLess(self.tone(output, 2.2, 0.6)[1], 0.001)
        self.assertAlmostEqual(self.tone(output, 3.2, 0.6)[0], 900, delta=10)

    def test_sound_changes_on_the_cut(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [self.clip(1, 0), self.clip(2, 1)]}]}
        output = self.render(data)
        self.assertAlmostEqual(self.tone(output, 0.9, 0.09)[0], 300, delta=30)
        self.assertAlmostEqual(self.tone(output, 1.01, 0.09)[0], 600, delta=30)

    def test_gaps_are_black_and_photos_work(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [self.clip(1, 0), {'id': 'p', 'media_id': 6, 'start': 2, 'in': 0, 'out': 1}]}]}
        output = self.render(data)
        self.assertEqual(self.frame_count(output), 90)
        self.assertLess(self.frame(output, 45).max(), 25)
        self.assertGreater(self.frame(output, 75)[360, 640, 0], 200)

    def test_speed_changes_length_and_keeps_pitch(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2, 'speed': 2}]}]}
        output = self.render(data)
        self.assertEqual(self.frame_count(output), 30)
        self.assertAlmostEqual(float(_run_ffprobe(output)['format']['duration']), 1, delta=0.08)
        self.assertAlmostEqual(self.tone(output, 0.2, 0.6)[0], 300, delta=10)

    def test_muted_clip_and_hidden_layer(self):
        data = {'format': self.FORMAT, 'layers': [
            {'id': 'main', 'kind': 'video', 'items': [self.clip(1, 0, muted=True)]},
            {'id': 'top', 'kind': 'video', 'hidden': True, 'items': [self.clip(3, 0)]}]}
        output = self.render(data)
        self.assertFalse(any(s['codec_type'] == 'audio' for s in _run_ffprobe(output)['streams']))
        self.assertGreater(self.frame(output, 15)[360, 640, 0], 200)

    def test_inactive_clip_stays_timed_but_is_absent_with_its_sound(self):
        data = {'format': self.FORMAT, 'layers': [
            {'id': 'main', 'kind': 'video', 'items': [self.clip(1, 0, muted=True)]},
            {'id': 'angle', 'kind': 'video', 'items': [{**self.clip(2, 0), 'enabled': False}]}]}
        output = self.render(data)
        self.assertEqual(self.frame_count(output), 30)
        self.assertGreater(self.frame(output, 15)[360, 640, 0], 200)
        self.assertFalse(any(stream['codec_type'] == 'audio' for stream in _run_ffprobe(output)['streams']))

    def test_keyframed_layer_lands_where_the_shared_math_says(self):
        transform = {'x': 0.2, 'y': 0.5, 'scale': 0.25, 'keyframes': {'x': [{'t': 0, 'v': 0.2, 'ease': 'easeInOut'}, {'t': 1.8, 'v': 0.8}]}}
        data = {'format': self.FORMAT, 'layers': [
            {'id': 'main', 'kind': 'video', 'items': [{'id': 'b', 'media_id': 3, 'start': 0, 'in': 0, 'out': 2}]},
            {'id': 'top', 'kind': 'video', 'items': [{'id': 'm', 'media_id': 1, 'start': 0.2, 'in': 0, 'out': 2, 'transform': transform}]}]}
        output = self.render(data)
        expected = Transform.model_validate(transform)
        for t in (0.5, 1.0, 1.5):
            image = self.frame(output, round(t * 30))
            mask = (image[..., 0] > 180) & (image[..., 1] < 80) & (image[..., 2] < 80)
            found = (np.where(mask.any(axis=0))[0][[0, -1]].sum()) / 2
            self.assertAlmostEqual(found, 1280 * value_at(expected, 'x', t - 0.2), delta=2.5)

    def test_tamil_text_is_shaped_and_timed(self):
        data = {'format': self.FORMAT, 'layers': [
            {'id': 'main', 'kind': 'video', 'items': [self.clip(3, 0)]},
            {'id': 'text', 'kind': 'text', 'items': [{'id': 't', 'start': 0.2, 'length': 0.4, 'text': 'கொஞ்சம் தமிழ்', 'style': 'band', 'position': 'center', 'size': 28}]}]}
        output = self.render(data)
        white = lambda number: int((self.frame(output, number)[250:470].min(axis=2) > 200).sum())
        self.assertLess(white(2), 50)
        self.assertGreater(white(12), 1000)
        self.assertLess(white(25), 50)

    def test_song_layer_fades_and_mixes(self):
        song = self.root / 'song.wav'
        run('-f', 'lavfi', '-i', 'sine=frequency=1200:sample_rate=48000', '-t', '3', str(song))
        data = {'format': self.FORMAT, 'layers': [
            {'id': 'main', 'kind': 'video', 'items': [self.clip(3, 0), self.clip(3, 1)]},
            {'id': 'a', 'kind': 'audio', 'items': [{'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 2, 'fade_out': 1}]}]}
        timeline = Timeline.model_validate(data)
        target = self.out / 'mix.mp4'
        render_timeline(timeline, self.facts.__getitem__, lambda _: song, target, lambda _: None)
        self.assertAlmostEqual(self.tone(target, 0.2, 0.5)[0], 1200, delta=10)
        self.assertLess(self.tone(target, 1.8, 0.15)[1], self.tone(target, 0.2, 0.5)[1] * 0.5)

    def test_cancel_stops_and_leaves_nothing(self):
        data = {'format': {'width': 1920, 'height': 1080, 'fps': 60}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': f'c{i}', 'media_id': 1, 'start': i * 2, 'in': 0, 'out': 2} for i in range(30)]}]}
        cancel = threading.Event()
        threading.Timer(0.4, cancel.set).start()
        with self.assertRaises(JobCancelled):
            self.render(data, should_cancel=cancel.is_set)
        self.assertFalse(list(self.out.iterdir()))


class Color(Clips):
    GREEN = (0, 192, 0)

    def tagged_clip(self, matrix):
        path = self.out / f'{matrix}.mp4'
        run('-f', 'lavfi', '-i', f'color=c=0x00C000:s=1280x720:r=30:d=1,scale=out_color_matrix={matrix}:out_range=tv,format=yuv420p',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-colorspace', matrix, str(path))
        return probe_video(path)

    def assert_color(self, frame, expected):
        for measured, wanted in zip(frame[frame.shape[0] // 2, frame.shape[1] // 2], expected):
            self.assertAlmostEqual(int(measured), wanted, delta=6)

    def exported(self, media_id, name):
        return self.render({'format': {'width': 1280, 'height': 720, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [
            {'id': 'c', 'media_id': media_id, 'start': 0, 'in': 0, 'out': 1}]}]}, f'{name}.mp4')

    def test_export_keeps_sd_and_hd_colors(self):
        for matrix in ('bt470bg', 'bt709'):
            with self.subTest(matrix=matrix):
                self.facts[20] = self.tagged_clip(matrix)
                self.assert_color(self.frame(self.exported(20, f'export-{matrix}'), 5), self.GREEN)

    def test_export_keeps_image_color(self):
        self.assert_color(self.frame(self.exported(6, 'image'), 5), (255, 0, 255))

    def test_proxy_keeps_sd_and_hd_colors(self):
        for matrix in ('bt470bg', 'bt709'):
            with self.subTest(matrix=matrix):
                target = self.out / f'proxy-{matrix}.mp4'
                make_proxy(self.tagged_clip(matrix), target, lambda: False)
                self.assert_color(self.frame(target, 5), self.GREEN)


class Sounds(Clips):
    """Each test measures the exported file, not the graph."""
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.song = cls.root / 'song.wav'
        run('-f', 'lavfi', '-i', 'sine=f=1200:d=6', '-af', 'volume=0.5', str(cls.song))

    def timeline(self, sounds, clips=None, **extra):
        clips = clips or [{'id': 'c', 'media_id': 3, 'start': 0, 'in': 0, 'out': 2, 'muted': True}]
        return {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': clips}, {'id': 'a', 'kind': 'audio', 'items': sounds}], **extra}

    def render_song(self, data, name='out.mp4'):
        target = self.out / name
        render_timeline(Timeline.model_validate(data), self.facts.__getitem__, lambda _: self.song, target, lambda _: None)
        return target

    def test_detached_sound_moves_independently_of_its_clip(self):
        # Clip 1 is red, with a 300 Hz tone. Its sound now plays a full second late.
        target = self.render({'format': self.FORMAT, 'layers': [
            {'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2, 'muted': True}]},
            {'id': 'a', 'kind': 'audio', 'items': [{'id': 's', 'media_id': 1, 'start': 1, 'in': 0, 'out': 1}]}]})
        self.assertLess(self.tone(target, 0.2, 0.6)[1], 0.001)
        self.assertAlmostEqual(self.tone(target, 1.2, 0.6)[0], 300, delta=10)

    def test_sound_speed_changes_pitch_free_length(self):
        target = self.render_song(self.timeline([{'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 2, 'speed': 2}]))
        self.assertAlmostEqual(self.tone(target, 0.2, 0.6)[0], 1200, delta=15)
        self.assertLess(self.tone(target, 1.2, 0.6)[1], 0.001)

    def test_fades_follow_the_item(self):
        target = self.render_song(self.timeline([{'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 2, 'fade_in': 1, 'fade_out': 0.5}]))
        start, middle, end = (self.tone(target, at, 0.1)[1] for at in (0.05, 1.2, 1.85))
        self.assertLess(start, middle * 0.25)
        self.assertLess(end, middle * 0.5)

    def test_overlong_fades_share_the_length(self):
        target = self.render_song(self.timeline([{'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 2, 'fade_in': 5, 'fade_out': 5}]))
        self.assertGreater(self.tone(target, 0.95, 0.1)[1], 0.03)

    def test_clip_fade_out(self):
        target = self.render({'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2, 'fade_out': 1}]}]})
        self.assertLess(self.tone(target, 1.85, 0.1)[1], self.tone(target, 0.3, 0.3)[1] * 0.4)

    def test_muted_sound_and_muted_layer_are_silent(self):
        sound = {'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 2, 'muted': True}
        self.assertFalse(has_stream(self.render_song(self.timeline([sound]), 'a.mp4'), 'audio'))
        data = self.timeline([{**sound, 'muted': False}])
        data['layers'][1]['muted'] = True
        self.assertFalse(has_stream(self.render_song(data, 'b.mp4'), 'audio'))

    def test_music_dips_under_other_sound(self):
        # Clip 1 has a tone for its 2 seconds; the music then runs on alone.
        data = self.timeline([{'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 4, 'duck': True}],
                             [{'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2}, {'id': 'd', 'media_id': 3, 'start': 2, 'in': 0, 'out': 2, 'muted': True}])
        target = self.render_song(data)
        under = self.band(target, 1200, 0.5, 1.2)
        alone = self.band(target, 1200, 3.0, 0.8)
        self.assertLess(under, alone * 0.6)
        self.assertGreater(under, alone * 0.05)

    def test_loudness_is_normalized_without_changing_length(self):
        data = self.timeline([{'id': 's', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 4, 'volume': 0.1}],
                             [{'id': 'c', 'media_id': 3, 'start': 0, 'in': 0, 'out': 4, 'muted': True}], normalize_audio=True)
        target = self.render_song(data)
        measured = subprocess.run([FFMPEG, '-hide_banner', '-i', str(target), '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], capture_output=True, text=True, timeout=60)
        loudness = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', measured.stderr)[-1])
        self.assertAlmostEqual(loudness, -14, delta=1.5)
        self.assertAlmostEqual(probe_video(target).duration, 4, delta=0.05)

    def band(self, path, frequency, start, seconds):
        data = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True, timeout=60)
        samples = np.frombuffer(data.stdout, dtype=np.float32)[round(start * 16000):round((start + seconds) * 16000)]
        phase = np.exp(-2j * np.pi * frequency * np.arange(len(samples)) / 16000)
        return float(abs((samples * phase).mean()) * 2)


def has_stream(path, kind):
    return kind in subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout


class Stems(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.patch = patch.object(settings, 'data_dir', self.root)
        self.patch.start()
        self.source = self.root / 'song.wav'
        run('-f', 'lavfi', '-i', 'sine=f=440:d=1', str(self.source))

    def tearDown(self):
        self.patch.stop()
        self.folder.cleanup()

    def fake_demucs(self, calls):
        def fake(source, output, device, on_progress, should_cancel):
            calls.append(device)
            if device == 'mps':
                return 1, 'mps refused'
            folder = output / 'htdemucs' / 'song'
            folder.mkdir(parents=True)
            for name in stem_service.STEM_FILES.values():
                (folder / name).write_bytes(b'stem')
            return 0, ''
        return fake

    def test_reports_a_plain_message_when_not_installed(self):
        with patch.object(stem_service, 'stems_available', return_value=False), self.assertRaisesRegex(ValueError, 'install-stems'):
            stem_service.separate(self.source, lambda _: None, lambda: False)

    def test_falls_back_to_cpu_and_keeps_the_result(self):
        calls = []
        with patch.object(stem_service, 'stems_available', return_value=True), patch.object(stem_service, 'run_demucs', self.fake_demucs(calls)):
            first = stem_service.separate(self.source, lambda _: None, lambda: False)
            second = stem_service.separate(self.source, lambda _: None, lambda: False)
        self.assertEqual(calls, ['mps', 'cpu'])
        self.assertEqual(first, second)
        self.assertTrue(resolve_audio_asset(first['music']).is_file())
        self.assertFalse(list(self.root.glob('.stems-*')))


class Retention(unittest.TestCase):
    def test_old_song_stays_while_an_edit_project_uses_it(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(settings, 'data_dir', Path(folder)):
            songs = Path(folder) / 'video_audio'
            songs.mkdir()
            kept, unused = songs / ('a' * 32), songs / ('b' * 32)
            for song in (kept, unused):
                song.write_bytes(b'x')
                os.utime(song, (1, 1))
            class Rows:
                def execute(self, sql, *_):
                    return self
                def fetchall(self):
                    return [{'recipe': json.dumps({'layers': [{'items': [{'asset_id': 'a' * 32}]}]})}]
                def commit(self):
                    pass
                def __enter__(self):
                    return self
                def __exit__(self, *_):
                    return False
            with patch.object(render_queue_service, 'get_connection', Rows):
                render_queue_service.recover_after_restart()
            self.assertTrue(kept.exists())
            self.assertFalse(unused.exists())


class Animations(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.mark = cls.root / 'mark.png'
        picture = Image.new('RGB', (640, 360), (0, 0, 0))
        picture.paste((255, 255, 255), (280, 140, 360, 220))
        picture.save(cls.mark)
        cls.facts[7] = MediaFacts(path=cls.mark, media_type='image', width=640, height=360)

    def timeline(self, **clip):
        return {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 7, 'start': 0, 'in': 0, 'out': 2, **clip}]}]}

    def center(self, frame):
        rows, columns = np.where(frame[:, :, 1] > 40)
        return (columns.mean(), rows.mean(), len(rows))

    def size(self):
        return (640, 360)

    def test_presets_match_the_shared_math(self):
        expected = json.loads((Path(__file__).parents[2] / 'timeline/fixtures/animation.expected.json').read_text())
        for preset, rows in expected['presets'].items():
            for row in rows:
                look = look_at(preset, row['p'])
                for key, value in look.items():
                    self.assertAlmostEqual(value, row[key], places=9)

    def test_every_preset_lands_where_the_math_says(self):
        for preset in ('slide-up', 'slide-left', 'zoom', 'pop', 'bounce'):
            with self.subTest(preset=preset):
                target = self.render(self.timeline(enter={'preset': preset, 'duration': 1}), f'{preset}.mp4')
                for frame_number in (12, 21):
                    look = look_at(preset, frame_number / 30)
                    frame = self.frame(target, frame_number, self.size())
                    x, y, _ = self.center(frame)
                    self.assertAlmostEqual(x, 320 * (1 + 2 * look['dx']) - 0.5, delta=3)
                    self.assertAlmostEqual(y, 180 + 360 * look['dy'] - 0.5, delta=3)

    def test_zoomed_clip_slides_in_as_a_cropped_frame(self):
        target = self.render(self.timeline(enter={'preset': 'slide-left', 'duration': 1}, transform={'scale': 2}))
        look = look_at('slide-left', 0.3)
        frame = self.frame(target, 9, self.size())
        edge = round(640 * look['dx'])
        # The enlarged white square would reach the left edge if the overflow were kept.
        self.assertEqual(frame[180, max(0, edge - 8), 1], 0)
        self.assertGreater(frame[180, min(639, edge + 320), 1], 200)

    def test_transition_keeps_length_and_cut(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [
            {'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2},
            {'id': 'b', 'media_id': 3, 'start': 2, 'in': 0, 'out': 2, 'transition_in': {'kind': 'wipe', 'duration': 1}}]}]}
        target = self.render(data)
        self.assertEqual(probe_frames(target), 120)
        middle = self.frame(target, 60, self.size())[180]
        self.assertGreater(middle[120, 0], 200)  # Red on the left.
        self.assertGreater(middle[520, 2], 200)  # Blue on the right.

    def test_transition_past_the_start_of_a_source_holds_its_first_frame(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [
            {'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2},
            {'id': 'b', 'media_id': 3, 'start': 2, 'in': 0, 'out': 2, 'transition_in': {'kind': 'crossfade', 'duration': 2}}]}]}
        self.assertEqual(probe_frames(self.render(data)), 120)

    def test_transition_replaces_the_enter_animation(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [
            {'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 2, 'exit': {'preset': 'fade', 'duration': 1}},
            {'id': 'b', 'media_id': 3, 'start': 2, 'in': 0, 'out': 2, 'enter': {'preset': 'fade', 'duration': 1}, 'transition_in': {'kind': 'wipe', 'duration': 0.5}}]}]}
        frame = self.frame(self.render(data), 70, self.size())
        self.assertGreater(frame[180, 320, 2], 200)

    def test_fill_keeps_source_detail(self):
        source = self.root / 'fine.png'
        lines = np.zeros((1440, 2560, 3), dtype=np.uint8)
        lines[:, ::8] = 255
        lines[:, 1::8] = 255
        lines[:, 2::8] = 255
        lines[:, 3::8] = 255
        Image.fromarray(lines).save(source)
        self.facts[8] = MediaFacts(path=source, media_type='image', width=2560, height=1440)
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 8, 'start': 0, 'in': 0, 'out': 1, 'transform': {'scale': 4}}]}]}
        row = self.frame(self.render(data), 5, self.size())[180, :, 1]
        self.assertGreater(int(row.max()) - int(row.min()), 120)

    def test_rotation_turns_clockwise_about_the_center(self):
        bar = self.root / 'bar.png'
        picture = Image.new('RGB', (640, 360), (0, 0, 0))
        picture.paste((255, 255, 255), (400, 170, 600, 190))  # A bar to the right of center.
        picture.save(bar)
        self.facts[10] = MediaFacts(path=bar, media_type='image', width=640, height=360)
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 10, 'start': 0, 'in': 0, 'out': 1, 'transform': {'rotation': 90, 'scale': 0.5}}]}]}
        x, y, _ = self.center(self.frame(self.render(data), 5, self.size()))
        self.assertAlmostEqual(x, 320, delta=4)
        self.assertGreater(y, 220)  # Clockwise on screen carries right to down.

    def test_rotation_keyframes_follow_the_curve(self):
        bar = self.root / 'dot.png'
        picture = Image.new('RGB', (640, 360), (0, 0, 0))
        picture.paste((255, 255, 255), (470, 165, 500, 195))
        picture.save(bar)
        self.facts[11] = MediaFacts(path=bar, media_type='image', width=640, height=360)
        transform = {'scale': 0.5, 'keyframes': {'rotation': [{'t': 0, 'v': 0, 'ease': 'linear'}, {'t': 2, 'v': 180}]}}
        target = self.render({'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 11, 'start': 0, 'in': 0, 'out': 2, 'transform': transform}]}]})
        frame = self.frame(target, 30, self.size())
        x, y, _ = self.center(frame)
        self.assertLess((frame[:, :, 1] > 40).sum(), 300)  # One dot, with no trail of old angles.
        radius = (485 - 320) * 0.5
        self.assertAlmostEqual(x, 320 + radius * np.cos(np.radians(90)), delta=4)
        self.assertAlmostEqual(y, 180 + radius, delta=4)

    def test_opacity_keyframes_are_eased_exactly(self):
        white = self.root / 'white.png'
        Image.new('RGB', (640, 360), (255, 255, 255)).save(white)
        self.facts[12] = MediaFacts(path=white, media_type='image', width=640, height=360)
        transform = {'keyframes': {'opacity': [{'t': 0, 'v': 0, 'ease': 'easeOut'}, {'t': 2, 'v': 1}]}}
        target = self.render({'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 12, 'start': 0, 'in': 0, 'out': 2, 'transform': transform}]}]})
        parsed = Transform.model_validate(transform)
        for number in (6, 15, 30, 45):
            self.assertAlmostEqual(int(self.frame(target, number, self.size())[180, 320, 1]), 255 * value_at(parsed, 'opacity', number / 30), delta=6)

    def test_transparent_logo_stays_transparent_over_video(self):
        logo = self.root / 'logo.png'
        picture = Image.new('RGBA', (200, 200), (0, 0, 0, 0))
        picture.paste((0, 255, 0, 255), (50, 50, 150, 150))
        picture.save(logo)
        self.facts[13] = MediaFacts(path=logo, media_type='image', width=200, height=200)
        target = self.render({'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1}]},
                                                                {'id': 'over', 'kind': 'video', 'items': [{'id': 'l', 'media_id': 13, 'start': 0, 'in': 0, 'out': 1, 'muted': True}]}]})
        frame = self.frame(target, 10, self.size())
        self.assertGreater(frame[180, 320, 1], 200)  # The logo.
        self.assertGreater(frame[180, 200, 0], 200)  # Red video through its clear corner area.
        self.assertGreater(frame[20, 320, 0], 200)

    def test_phone_photo_exports_upright(self):
        path = self.root / 'phone.jpg'
        picture = Image.new('RGB', (400, 240), (0, 0, 0))
        picture.paste((255, 255, 255), (0, 0, 100, 240))  # Stored sideways: the left is the top once turned.
        exif = Image.Exif()
        exif[0x0112] = 6
        picture.save(path, exif=exif, quality=95)
        self.facts[14] = MediaFacts(path=path, media_type='image', width=240, height=400)
        data = {'format': {'width': 240, 'height': 400, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 14, 'start': 0, 'in': 0, 'out': 0.5}]}]}
        frame = self.frame(self.render(data), 3, (240, 400))
        self.assertGreater(frame[40, 120, 1], 200)  # White across the top, once turned.
        self.assertLess(frame[350, 120, 1], 60)

    def test_each_clip_keeps_its_own_opacity(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [
            {'id': 'a', 'media_id': 6, 'start': 0, 'in': 0, 'out': 1, 'transform': {'opacity': 0.5}},
            {'id': 'b', 'media_id': 6, 'start': 1, 'in': 0, 'out': 1}]}]}
        target = self.render(data)
        self.assertLess(self.frame(target, 15, self.size())[180, 320, 0], 160)
        self.assertGreater(self.frame(target, 45, self.size())[180, 320, 0], 230)

    def test_looks_use_the_preview_math(self):
        gray = self.root / 'gray.png'
        Image.new('RGB', (240, 240), (200, 100, 50)).save(gray)
        self.facts[9] = MediaFacts(path=gray, media_type='image', width=240, height=240)
        for look, (red, green, blue, contrast, saturation) in LOOKS.items():
            with self.subTest(look=look):
                value = np.array([200 * red, 100 * green, 50 * blue]) / 255
                value = np.clip((np.clip(value, 0, 1) - 0.5) * contrast + 0.5, 0, 1)
                luma = value @ np.array([0.2126, 0.7152, 0.0722])
                wanted = np.clip(luma + (value - luma) * saturation, 0, 1) * 255
                data = {'format': {'width': 240, 'height': 240, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 9, 'start': 0, 'in': 0, 'out': 0.3, 'look': look}]}]}
                measured = self.frame(self.render(data, f'{look}.mp4'), 3, (240, 240))[120, 120]
                for got, want in zip(measured, wanted):
                    self.assertAlmostEqual(int(got), float(want), delta=5)

    def text_timeline(self, **animation):
        return {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 3, 'start': 0, 'in': 0, 'out': 2, 'muted': True}]},
                                                  {'id': 'words', 'kind': 'text', 'items': [{'id': 't', 'start': 0.5, 'length': 1.5, 'text': 'தமிழ் வாழ்க கண்டேன்', 'style': 'outline', 'position': 'center', 'size': 40, **animation}]}]}

    def test_tamil_keeps_its_shape_through_animation(self):
        still = self.render(self.text_timeline(), 'still.mp4')
        moving = self.render(self.text_timeline(enter={'preset': 'slide-left', 'duration': 1}), 'moving.mp4')
        rest = self.frame(still, 40, self.size())
        shifted = self.frame(moving, 30, self.size())
        offset = round(640 * look_at('slide-left', 0.5)['dx'])
        white = lambda frame: (frame.min(axis=2) > 200).astype(int)
        # The same letters, moved: the shaped text can't have changed.
        self.assertLess(np.abs(white(rest)[:, 200:440 - offset] - white(shifted)[:, 200 + offset:440]).mean(), 0.02)
        self.assertGreater(white(rest).sum(), 300)

    def test_text_is_absent_before_its_start(self):
        target = self.render(self.text_timeline())
        self.assertEqual((self.frame(target, 10, self.size()).min(axis=2) > 200).sum(), 0)


def probe_frames(path):
    return int(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout.strip().rstrip(','))


class Layers(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for name, color in (('under', (200, 100, 50)), ('top', (60, 180, 220))):
            path = cls.root / f'{name}.png'
            Image.new('RGB', (640, 360), color).save(path)
            cls.facts[20 if name == 'under' else 21] = MediaFacts(path=path, media_type='image', width=640, height=360)

    def stack(self, **top):
        return {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 20, 'start': 0, 'in': 0, 'out': 1}]},
                                                  {'id': 'up', 'kind': 'video', **top, 'items': [{'id': 'b', 'media_id': 21, 'start': 0, 'in': 0, 'out': 1, 'transform': {'scale': 0.5}}]}]}

    def test_blend_modes_follow_their_formulas(self):
        b, s = np.array([200, 100, 50]) / 255, np.array([60, 180, 220]) / 255
        wanted = {'multiply': b * s, 'screen': 1 - (1 - b) * (1 - s), 'overlay': np.where(b < 0.5, 2 * b * s, 1 - 2 * (1 - b) * (1 - s)), 'darken': np.minimum(b, s), 'lighten': np.maximum(b, s)}
        for mode, color in wanted.items():
            with self.subTest(mode=mode):
                frame = self.frame(self.render(self.stack(blend=mode), f'{mode}.mp4'), 5, (640, 360))
                for got, want in zip(frame[180, 320], color * 255):
                    self.assertAlmostEqual(int(got), float(want), delta=6)
                for got, want in zip(frame[20, 20], (200, 100, 50)):  # Outside the layer's shape, nothing changes.
                    self.assertAlmostEqual(int(got), want, delta=6)

    def test_hidden_layer_is_absent_with_its_sound(self):
        data = self.stack(hidden=True)
        data['layers'][1]['items'] = [{'id': 'b', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1}]
        target = self.render(data)
        for got, want in zip(self.frame(target, 5, (640, 360))[180, 320], (200, 100, 50)):
            self.assertAlmostEqual(int(got), want, delta=6)
        self.assertFalse(has_stream(target, 'audio'))

    def test_layer_order_decides_what_is_in_front(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 20, 'start': 0, 'in': 0, 'out': 1}]},
                                                  {'id': 'one', 'kind': 'video', 'items': [{'id': 'b', 'media_id': 21, 'start': 0, 'in': 0, 'out': 1, 'transform': {'scale': 0.5}}]},
                                                  {'id': 'two', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 20, 'start': 0, 'in': 0, 'out': 1, 'transform': {'scale': 0.25}}]}]}
        self.assertLess(self.frame(self.render(data), 5, (640, 360))[180, 320, 2], 90)

    def test_six_layers_export_at_the_limit(self):
        layers = [{'id': f'l{n}', 'kind': 'video', 'blend': 'screen' if n == 3 else 'normal', 'items': [{'id': f'c{n}', 'media_id': 1 + n % 3, 'start': 0, 'in': 0, 'out': 1, 'transform': {'scale': 1 - n * 0.1}}]} for n in range(6)]
        self.assertEqual(probe_frames(self.render({'format': self.FORMAT, 'layers': layers})), 30)

    def test_a_seventh_layer_is_refused_in_plain_words(self):
        layers = [{'id': f'l{n}', 'kind': 'video', 'items': []} for n in range(7)]
        with self.assertRaisesRegex(ValidationError, 'up to 6 video layers'):
            Timeline.model_validate({'layers': layers})

    def test_draft_is_the_same_length(self):
        data = self.stack()
        final, draft = self.out / 'final.mp4', self.out / 'draft.mp4'
        render_timeline(Timeline.model_validate(data), self.facts.__getitem__, lambda asset: self.root / asset, final, lambda _: None)
        render_timeline(Timeline.model_validate(data), self.facts.__getitem__, lambda asset: self.root / asset, draft, lambda _: None, draft=True)
        self.assertEqual(probe_frames(final), probe_frames(draft))


class ChromaKey(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        back = cls.root / 'back.png'
        Image.new('RGB', (640, 360), (200, 40, 40)).save(back)
        green = Image.new('RGB', (640, 360), (0, 177, 64))
        green.paste((230, 230, 230), (220, 100, 420, 260))
        screen = cls.root / 'screen.png'
        green.save(screen)
        cls.facts[30] = MediaFacts(path=back, media_type='image', width=640, height=360)
        cls.facts[31] = MediaFacts(path=screen, media_type='image', width=640, height=360)
        video = cls.root / 'screen.mp4'
        run('-loop', '1', '-i', str(screen), '-t', '1', '-r', '30', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '10', '-colorspace', 'bt709', str(video))
        cls.facts[32] = probe_video(video)

    def stack(self, media, chroma):
        return {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 30, 'start': 0, 'in': 0, 'out': 1}]},
                                                  {'id': 'up', 'kind': 'video', 'items': [{'id': 'b', 'media_id': media, 'start': 0, 'in': 0, 'out': 1, 'chroma': chroma}]}]}

    def test_green_goes_and_the_subject_stays(self):
        for media in (31, 32):
            with self.subTest(media=media):
                frame = self.frame(self.render(self.stack(media, {'color': '#00b140'}), f'k{media}.mp4'), 5, (640, 360))
                for got, want in zip(frame[30, 30], (200, 40, 40)):
                    self.assertAlmostEqual(int(got), want, delta=8)
                for got in frame[180, 320]:
                    self.assertAlmostEqual(int(got), 230, delta=8)

    def test_key_colour_converts_to_limited_range_bt709(self):
        self.assertEqual(chroma_yuv('#00b140'), (129, 96, 55))

    def test_blue_screen_uses_blue_despill(self):
        self.assertIn('despill=type=blue', ','.join(chroma_filters(Chroma(color='#0047bb'), False)))

    def test_no_spill_removal_when_turned_off(self):
        self.assertNotIn('despill', ','.join(chroma_filters(Chroma(spill=0), False)))


class Rules(unittest.TestCase):
    def test_overlapping_items_are_refused(self):
        with self.assertRaisesRegex(ValidationError, 'overlap'):
            Timeline.model_validate({'layers': [{'id': 'm', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'out': 3}, {'id': 'b', 'media_id': 1, 'start': 2, 'out': 3}]}]})

    def test_layer_limit_and_unique_ids(self):
        with self.assertRaisesRegex(ValidationError, 'video layers'):
            Timeline.model_validate({'layers': [{'id': str(i), 'kind': 'video'} for i in range(7)]})
        with self.assertRaisesRegex(ValidationError, 'own id'):
            Timeline.model_validate({'layers': [{'id': 'a', 'kind': 'video'}, {'id': 'a', 'kind': 'audio'}]})

    def test_expression_matches_reference_math(self):
        fixture = json.loads((Path(__file__).parents[2] / 'timeline/fixtures/keyframes.json').read_text())
        transform = Transform.model_validate(fixture['transform'])
        expression = property_expression(transform, 'x')
        python = expression.replace('pow', 'POW')
        functions = {'POW': pow, 'lt': lambda a, b: a < b, 'lte': lambda a, b: a <= b}
        python = _expression_to_python(python)
        for t in fixture['samples']:
            self.assertAlmostEqual(eval(python, {**functions, 't': t}), value_at(transform, 'x', t), places=9)

    def test_atempo_stays_in_range(self):
        self.assertEqual(atempo_chain(1), [])
        self.assertEqual(atempo_chain(4), ['atempo=2.0', 'atempo=2.0'])
        self.assertEqual(atempo_chain(0.25), ['atempo=0.5', 'atempo=0.5'])

    def test_old_recipes_upgrade(self):
        old = {'version': 1, 'clips': [{'photo_id': 7, 'in': 1.5, 'out': None}], 'settings': {'rotation': 90, 'brightness': 1.2, 'mute': True, 'volume': 0.5}}
        upgraded = Timeline.model_validate(upgrade_edit_recipe(old, 7, 10, 1920, 1080))
        clip = upgraded.layers[0].items[0]
        self.assertEqual((clip.media_id, clip.in_, clip.out, clip.muted, clip.adjust.rotation, clip.adjust.brightness), (7, 1.5, 10, True, 90, 1.2))
        self.assertEqual((upgraded.format.width, upgraded.format.height), (1080, 1920))
        self.assertEqual(upgrade_edit_recipe({'version': 2, 'layers': []}, 1, 1, 1, 1), {'version': 2, 'layers': []})
        self.assertEqual(Timeline.model_validate(upgrade_edit_recipe(None, 3, 5, 1921, 1081)).format.width, 1920)


def _expression_to_python(expression):
    """Rewrites the if(a,b,c) form so the real ffmpeg expression can be evaluated here."""
    while 'if(' in expression:
        start = expression.rindex('if(')
        depth, parts, cursor = 0, [], start + 3
        for index in range(start + 3, len(expression)):
            char = expression[index]
            if char == '(':
                depth += 1
            elif char == ')':
                if depth == 0:
                    parts.append(expression[cursor:index])
                    expression = f'(({parts[1]}) if ({parts[0]}) else ({parts[2]}))'.join((expression[:start], expression[index + 1:]))
                    break
                depth -= 1
            elif char == ',' and depth == 0:
                parts.append(expression[cursor:index])
                cursor = index + 1
    return expression


class Assets(Clips):
    def setUp(self):
        super().setUp()
        self.patches = [patch.object(settings, 'data_dir', self.out)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        super().tearDown()

    def wait(self, job_id):
        for _ in range(600):
            job = get_job(job_id)
            if job and job['done']:
                return job
            time.sleep(0.05)
        self.fail('job did not finish')

    def prepared(self, name):
        path = self.root / f'{name}.mp4'
        first = asset_service.request_assets(path, name)
        self.assertEqual(first['status'], 'preparing')
        job = self.wait(first['job_id'])
        self.assertEqual(job['status'], 'done', job.get('error'))
        return path, asset_service.request_assets(path, name)

    def test_proxy_filmstrip_and_peaks(self):
        path, ready = self.prepared('red')
        self.assertEqual(ready['status'], 'ready')
        folder = asset_service.folder_for(ready['key'])
        proxy = self.video(folder / 'proxy.mp4')
        self.assertEqual((proxy['codec_name'], proxy['height'], proxy['color_space']), ('h264', 720, 'bt709'))
        self.assertAlmostEqual(float(_run_ffprobe(folder / 'proxy.mp4')['format']['duration']), 2.2, delta=0.1)
        with Image.open(folder / 'filmstrip.jpg') as sprite:
            self.assertEqual(sprite.size, (ready['filmstrip']['tiles'] * ready['filmstrip']['tile_width'], 90))
        peaks = json.loads((folder / 'peaks.json').read_text())
        self.assertEqual(peaks['peaks_per_second'], 20)
        self.assertAlmostEqual(len(peaks['peaks']), 44, delta=2)
        self.assertGreater(max(peaks['peaks']), 10)

    def test_rotated_hdr_and_silent_clips_prepare(self):
        _, green = self.prepared('green')
        proxy = self.video(asset_service.folder_for(green['key']) / 'proxy.mp4')
        self.assertLess(int(proxy.get('width')) if not proxy.get('side_data_list') else 0, 1280)
        _, hdr = self.prepared('hdr')
        proxy = self.video(asset_service.folder_for(hdr['key']) / 'proxy.mp4')
        self.assertEqual((proxy['pix_fmt'], proxy['color_transfer']), ('yuv420p', 'bt709'))
        self.assertEqual(json.loads((asset_service.folder_for(hdr['key']) / 'peaks.json').read_text())['peaks'], [])

    def test_a_second_request_joins_the_running_job(self):
        release = threading.Event()
        blocker = render_queue_service.enqueue_render('test', 'hold', lambda _: release.wait(10) and {})
        path = self.root / 'blue.mp4'
        first = asset_service.request_assets(path, 'blue')
        second = asset_service.request_assets(path, 'blue')
        self.assertEqual(first['job_id'], second['job_id'])
        release.set()
        self.wait(blocker)
        self.wait(first['job_id'])

    def test_exports_run_before_background_preparation(self):
        release = threading.Event()
        order = []
        blocker = render_queue_service.enqueue_render('test', 'hold', lambda _: release.wait(10) and {})
        low = render_queue_service.enqueue_render('test', 'low', lambda _: order.append('low') or {}, priority=render_queue_service.BACKGROUND_PRIORITY)
        high = render_queue_service.enqueue_render('test', 'high', lambda _: order.append('high') or {})
        release.set()
        self.wait(blocker); self.wait(low); self.wait(high)
        self.assertEqual(order, ['high', 'low'])

    def test_cache_drops_least_recently_used_first(self):
        import os
        for index, name in enumerate(('old', 'new')):
            folder = asset_service.folder_for(name)
            folder.mkdir(parents=True)
            (folder / 'proxy.mp4').write_bytes(b'x' * 1000)
            os.utime(folder, (1000 + index, 1000 + index))
        asset_service.prune_cache(limit=1500)
        self.assertFalse(asset_service.folder_for('old').exists())
        self.assertTrue(asset_service.folder_for('new').exists())


class Transcripts(unittest.TestCase):
    def test_words_are_trimmed_and_always_move_forward(self):
        words = [{'word': ' Hello', 'start': 0.0, 'end': 0.4}, {'word': ' ', 'start': 0.4, 'end': 0.5}, {'word': 'there', 'start': 0.3, 'end': 0.8}, {'word': 'lost', 'start': 0.9, 'end': 0.9}]
        self.assertEqual(transcript_service.clean_words(words), [{'w': 'Hello', 's': 0.0, 'e': 0.4}, {'w': 'there', 's': 0.4, 'e': 0.8}])


class Api(Clips):
    def add_video(self):
        with open(self.root / 'red.mp4', 'rb') as file:
            return self.client.post('/api/media', files={'file': ('talk.mp4', file.read())}).json()

    def test_transcript_is_saved_and_kept_per_language(self):
        media = self.add_video()
        self.assertIsNone(self.client.get(f"/api/photos/{media['id']}/words?language=ta").json()['words'])
        target = transcript_service.transcript_file(Path(media['absolute_path']), 'ta')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps([{'w': 'வணக்கம்', 's': 0, 'e': 0.5}]), encoding='utf-8')
        self.assertEqual(self.client.get(f"/api/photos/{media['id']}/words?language=ta").json()['words'][0]['w'], 'வணக்கம்')
        self.assertIsNone(self.client.get(f"/api/photos/{media['id']}/words?language=en").json()['words'])

    def test_transcripts_refuse_photos_and_unknown_languages(self):
        media = self.add_media()
        self.assertEqual(self.client.get(f"/api/photos/{media['id']}/words").status_code, 400)
        video = self.add_video()
        self.assertEqual(self.client.post(f"/api/photos/{video['id']}/words?language=xx").status_code, 400)

    def add_media(self, name='clip.png'):
        picture = io.BytesIO()
        Image.new('RGB', (64, 64), (10, 20, 30)).save(picture, 'PNG')
        return self.client.post('/api/media', files={'file': (name, picture.getvalue())}).json()

    def add_project(self, cover):
        video = shutil.copy(self.root / 'red.mp4', self.out / 'cover.mp4')
        with open(video, 'rb') as file:
            first = self.client.post('/api/media', files={'file': ('cover.mp4', file.read())}).json()
        return first, self.client.post('/api/projects', json={'name': 'Trip', 'kind': 'edit', 'media_id': first['id'], 'media_ids': [first['id']]}).json()

    def timeline_with(self, *ids):
        return {'recipe': {'version': 2, 'format': {'width': 640, 'height': 360, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': f'c{i}', 'media_id': i, 'start': 0, 'in': 0, 'out': 1} for i in ids]}]}}

    def test_folder_is_saved_and_cleared(self):
        media = self.add_media()
        self.assertEqual(self.client.patch(f"/api/photos/{media['id']}", json={'folder': '  Parade '}).json()['folder'], 'Parade')
        self.assertEqual(self.client.get(f"/api/photos/{media['id']}").json()['folder'], 'Parade')
        self.assertIsNone(self.client.patch(f"/api/photos/{media['id']}", json={'folder': ' '}).json()['folder'])

    def test_unused_media_is_deleted_with_its_file(self):
        media = self.add_media()
        path = Path(media['absolute_path'])
        self.assertTrue(path.exists())
        self.assertEqual(self.client.delete(f"/api/photos/{media['id']}").status_code, 200)
        self.assertFalse(path.exists())
        self.assertEqual(self.client.get(f"/api/photos/{media['id']}").status_code, 404)

    def test_media_on_a_timeline_cannot_be_deleted(self):
        media = self.add_media()
        _, project = self.add_project(media)
        self.client.put(f"/api/projects/{project['id']}/recipe", json=self.timeline_with(media['id']))
        response = self.client.delete(f"/api/photos/{media['id']}")
        self.assertEqual(response.status_code, 409)
        self.assertIn('Trip', response.json()['detail'])
        self.assertTrue(Path(media['absolute_path']).exists())

    def test_cover_moves_on_when_only_the_cover_uses_it(self):
        other = self.add_media()
        cover, project = self.add_project(other)
        self.client.put(f"/api/projects/{project['id']}/recipe", json=self.timeline_with(other['id']))
        self.assertEqual(self.client.delete(f"/api/photos/{cover['id']}").status_code, 200)
        self.assertEqual(self.client.get(f"/api/projects/{project['id']}").json()['media_id'], other['id'])

    def test_a_projects_only_media_cannot_be_deleted(self):
        cover, _ = self.add_project(None)
        self.assertEqual(self.client.delete(f"/api/photos/{cover['id']}").status_code, 409)

    def test_built_page_is_served_without_leaving_its_folder(self):
        dist = self.out / 'dist'
        dist.mkdir()
        (dist / 'index.html').write_text('app page')
        (dist / 'logo.txt').write_text('logo')
        (self.out / 'secret.txt').write_text('secret')
        with patch('app.main.FRONTEND', dist):
            self.assertEqual(self.client.get('/').text, 'app page')
            self.assertEqual(self.client.get('/logo.txt').text, 'logo')
            self.assertEqual(self.client.get('/projects/5').text, 'app page')
            self.assertEqual(self.client.get('/..%2Fsecret.txt').text, 'app page')
            self.assertEqual(self.client.get('/api/nothing').status_code, 404)

    def test_transparent_picture_previews_with_its_transparency(self):
        logo = self.out / 'logo.png'
        Image.new('RGBA', (64, 64), (0, 255, 0, 0)).save(logo)
        with patch('app.api.routes.get_media', return_value={'media_type': 'image', 'absolute_path': str(logo)}):
            response = self.client.get('/api/photos/1/image')
        self.assertEqual(response.headers['content-type'], 'image/png')
        with Image.open(io.BytesIO(response.content)) as picture:
            self.assertEqual(picture.convert('RGBA').getpixel((5, 5))[3], 0)

    def setUp(self):
        super().setUp()
        self.patches = [patch.object(settings, 'data_dir', self.out / 'data'), patch.object(settings, 'edit_workspace_dir', self.out / 'data' / 'exports'), patch.object(settings, 'thumbnail_dir', self.out / 'data' / 'thumbnails')]
        for item in self.patches:
            item.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches):
            item.stop()
        super().tearDown()

    def upload(self, name):
        return self.client.post('/api/media', files={'file': (f'{name}.mp4', (self.root / f'{name}.mp4').read_bytes(), 'video/mp4')}).json()

    def test_project_timeline_exports_two_clips(self):
        red, blue = self.upload('red'), self.upload('blue')
        project = self.client.post('/api/projects', json={'name': 'Two clips', 'kind': 'edit', 'media_id': red['id']}).json()
        timeline = self.client.get(f"/api/projects/{project['id']}/timeline").json()
        self.assertEqual(timeline['version'], 2)
        timeline['layers'][0]['items'][0].update({'in': 0, 'out': 1})
        timeline['layers'][0]['items'].append({'id': 'clip-2', 'media_id': blue['id'], 'start': 1, 'in': 0, 'out': 1})
        job_id = self.client.post(f"/api/projects/{project['id']}/export", json=timeline).json()['job_id']
        for _ in range(400):
            job = self.client.get(f'/api/jobs/{job_id}/status').json()
            if job['done']:
                break
            time.sleep(0.05)
        self.assertEqual(job['status'], 'done', job.get('error'))
        output = self.client.get(f"/api/photos/{job['output_photo_id']}").json()
        self.assertAlmostEqual(output['duration'], 2, delta=0.1)
        self.assertEqual(self.client.get('/api/photos?collection=workspace').json()['total'], 1)

    def test_invalid_timeline_and_lyric_project_are_refused(self):
        red = self.upload('red')
        project = self.client.post('/api/projects', json={'name': 'P', 'kind': 'edit', 'media_id': red['id']}).json()
        bad = {'layers': [{'id': 'm', 'kind': 'video', 'items': [{'id': 'a', 'media_id': red['id'], 'start': 0, 'out': 3}, {'id': 'b', 'media_id': red['id'], 'start': 1, 'out': 3}]}]}
        response = self.client.post(f"/api/projects/{project['id']}/export", json=bad)
        self.assertEqual(response.status_code, 400)
        self.assertIn('overlap', response.json()['detail'])
        self.assertEqual(self.client.post(f"/api/projects/{project['id']}/export", json={'layers': []}).status_code, 400)
        self.assertEqual(self.client.get('/api/photos/999/assets').status_code, 404)


class BlurBoxes(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Fine stripes: blurring or blocking flattens them, so what changed is easy to measure.
        stripes = np.zeros((360, 640, 3), np.uint8)
        stripes[:, ::4] = 255
        stripes[:, 1::4] = 255
        path = cls.root / 'stripes.png'
        Image.fromarray(stripes).save(path)
        cls.facts[40] = MediaFacts(path=path, media_type='image', width=640, height=360)

    def stack(self, blur):
        box = {'id': 'b', 'start': 0.5, 'length': 1, 'width': 0.3, 'height': 0.4, **blur}
        return {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 40, 'start': 0, 'in': 0, 'out': 2}]},
                                                  {'id': 'hide', 'kind': 'blur', 'items': [box]}]}

    def detail(self, frame, x, y):
        patch = frame[y - 10:y + 10, x - 10:x + 10].astype(float)
        return patch.std()

    def test_only_the_box_and_its_time_are_hidden(self):
        for style in ('blur', 'pixelate'):
            with self.subTest(style=style):
                path = self.render(self.stack({'style': style}), f'{style}.mp4')
                before, during, after = (self.frame(path, number, (640, 360)) for number in (5, 30, 55))
                self.assertGreater(self.detail(before, 320, 180), 60)
                self.assertGreater(self.detail(after, 320, 180), 60)
                self.assertLess(self.detail(during, 320, 180), 25)
                self.assertGreater(self.detail(during, 60, 60), 60)

    def test_box_follows_its_keyframes(self):
        moving = {'transform': {'x': 0.25, 'y': 0.5, 'keyframes': {'x': [{'t': 0, 'v': 0.25}, {'t': 1, 'v': 0.75}]}}}
        frame = self.frame(self.render(self.stack(moving), 'moving.mp4'), 30, (640, 360))
        # Half a second into the box, the box is centred at 0.5 of the frame and gone from where it started.
        self.assertLess(self.detail(frame, 320, 180), 25)
        self.assertGreater(self.detail(frame, 160, 180), 60)


class Tracking(unittest.TestCase):
    """A patterned disc crosses a noisy background. Halfway through the second clip it is gone."""

    @staticmethod
    def centres(frame):
        return 60 + frame * 2.0, 90 + 30 * math.sin(frame / 15)

    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp())
        rng = np.random.default_rng(3)
        background = (rng.random((45, 80, 3)) * 200).astype(np.uint8).repeat(4, 0).repeat(4, 1)
        rows, columns = np.mgrid[0:180, 0:320]
        for name, vanish in (('moving.mp4', None), ('vanishing.mp4', 30)):
            frames = []
            for frame in range(60):
                picture = background.copy()
                if vanish is None or frame < vanish:
                    x, y = cls.centres(frame)
                    distance = np.hypot(columns - x, rows - y)
                    picture[distance < 18] = (240, 240, 40)
                    picture[distance < 8] = (200, 30, 30)
                frames.append(picture)
            process = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '320x180', '-r', '30', '-i', '-', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', str(cls.root / name)], stdin=subprocess.PIPE)
            process.communicate(b''.join(picture.tobytes() for picture in frames))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def track(self, name, at):
        x, y = self.centres(round(at * 30))
        return tracking_service.track(self.root / name, (320, 180), at, (x / 320, y / 180, 40 / 320, 40 / 180), 0, 2, lambda progress: None, lambda: False)

    def test_follows_both_ways_from_the_drawn_frame(self):
        result = self.track('moving.mp4', 1.0)
        self.assertFalse(result['lost_before'] or result['lost_after'])
        self.assertEqual(len(result['points']), 60)
        for seconds, x, y, *_ in result['points']:
            want_x, want_y = self.centres(round(seconds * 30))
            self.assertLess(math.hypot(x * 320 - want_x, y * 180 - want_y), 4, seconds)

    def test_stops_where_the_subject_is_lost(self):
        result = self.track('vanishing.mp4', 0.5)
        self.assertTrue(result['lost_after'])
        self.assertLessEqual(result['points'][-1][0], 1.1)

    def test_cancel_stops_tracking(self):
        with self.assertRaises(JobCancelled):
            tracking_service.track(self.root / 'moving.mp4', (320, 180), 0, (0.2, 0.5, 0.1, 0.2), 0, 2, lambda progress: None, lambda: True)


class MovingTitles(Clips):
    def test_title_follows_its_own_keyframes(self):
        image = self.root / 'grey.png'
        Image.new('RGB', (640, 360), (40, 40, 40)).save(image)
        self.facts[50] = MediaFacts(path=image, media_type='image', width=640, height=360)
        title = {'id': 't', 'start': 0, 'length': 2, 'text': 'IIIIIIII', 'style': 'shadow', 'position': 'center', 'size': 60, 'color': '#ffffff',
                 'transform': {'keyframes': {'x': [{'t': 0, 'v': 0.25}, {'t': 2, 'v': 0.75}]}}}
        data = {'format': {'width': 640, 'height': 360, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 50, 'start': 0, 'in': 0, 'out': 2}]}, {'id': 'words', 'kind': 'text', 'items': [title]}]}
        path = self.render(data, 'title.mp4')
        centres = []
        for number in (3, 30, 57):
            frame = self.frame(path, number, (640, 360)).astype(int)
            columns = np.nonzero(frame[:, :, 0].max(axis=0) > 200)[0]
            centres.append((columns.min() + columns.max()) / 2 / 640)
        for got, want in zip(centres, (0.25 + 0.5 * 3 / 60, 0.5, 0.25 + 0.5 * 57 / 60)):
            self.assertAlmostEqual(got, want, delta=0.03)

    def test_old_titles_without_a_transform_still_load(self):
        Timeline.model_validate({'layers': [{'id': 'w', 'kind': 'text', 'items': [{'id': 't', 'start': 0, 'length': 1, 'text': 'Hi'}]}]})


class Faces(unittest.TestCase):
    """The linking, gaps and limits, with a stand-in detector. The real detector is checked by hand on real faces."""

    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp())
        cls.video = cls.root / 'blank.mp4'
        run('-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30:d=2', '-pix_fmt', 'yuv420p', str(cls.video))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def find(self, seen):
        count = [0]

        def factory(size):
            def detect(picture):
                count[0] += 1
                return seen(count[0] - 1)
            return detect
        return face_service.find_faces(self.video, (320, 180), 0, 2, lambda progress: None, lambda: False, detector_factory=factory)

    def test_two_people_stay_apart_and_a_gap_is_filled(self):
        def seen(frame):
            faces = []
            if not 20 <= frame < 26:  # Hidden for six frames.
                faces.append(((0.2 + frame * 0.005, 0.5, 0.1, 0.15), 0.9))
            faces.append(((0.8, 0.3 + frame * 0.003, 0.08, 0.12), 0.8))
            return faces
        result = self.find(seen)
        self.assertEqual(len(result['faces']), 2)
        moving = next(path for path in result['faces'] if path[0][1] < 0.5)
        self.assertEqual(len(moving), 60)
        self.assertAlmostEqual(moving[23][1], 0.2 + 23 * 0.005, delta=0.003)
        self.assertAlmostEqual(moving[23][3], 0.1 * face_service.PAD_WIDTH, delta=0.002)

    def test_brief_sightings_are_dropped_and_faces_are_capped(self):
        def seen(frame):
            flicker = [((0.5, 0.5, 0.1, 0.1), 0.7)] if frame < 3 else []
            crowd = [((0.04 + number * 0.07, 0.8, 0.03, 0.05), 0.9) for number in range(14)]
            return flicker + crowd
        result = self.find(seen)
        self.assertEqual(len(result['faces']), face_service.MAX_FACES)
        self.assertEqual(result['more'], 2)

    def test_a_half_hidden_face_keeps_its_blur_size(self):
        result = self.find(lambda frame: [((0.5, 0.5, 0.05 if 25 <= frame < 35 else 0.1, 0.15), 0.9)])
        widths = [point[3] for point in result['faces'][0]]
        self.assertGreaterEqual(min(widths), 0.1 * face_service.MIN_SIZE_SHARE * face_service.PAD_WIDTH - 0.004)

    def test_a_wrong_download_is_refused(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False
        with tempfile.TemporaryDirectory() as folder, patch.object(settings, 'model_cache_dir', Path(folder)), patch('urllib.request.urlopen', lambda *a, **k: Response(b'not a model')):
            with self.assertRaises(RuntimeError):
                face_service.model_path()
            self.assertFalse((Path(folder) / 'face' / face_service.MODEL_NAME).exists())


class QuickEffects(Clips):
    """A clip that gets brighter every frame, with a tone, so a frame's brightness says which moment it came from."""
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ramp = cls.root / 'ramp.mp4'
        run('-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
            '-vf', "geq=lum='min(235,16+N*2)':cb=128:cr=128", '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', str(ramp))
        cls.facts[60] = probe_video(ramp)

    def setUp(self):
        super().setUp()
        self.data = patch.object(settings, 'data_dir', self.out / 'data')
        self.data.start()

    def tearDown(self):
        self.data.stop()
        super().tearDown()

    def level(self, path, number, size=(640, 360)):
        return self.frame(path, number, size)[size[1] // 2, size[0] // 2, 0]

    def source_frame(self, path, number):
        """Which source frame an exported frame shows, from its brightness."""
        if not hasattr(self, 'levels'):
            raw = subprocess.run([FFMPEG, '-v', 'error', '-i', str(self.facts[60].path), '-vf', 'scale=in_color_matrix=bt709:in_range=tv', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
            self.levels = np.frombuffer(raw, np.uint8).reshape(-1, 180, 320, 3)[:, 90, 160, 0].astype(int)
        return int(np.argmin(np.abs(self.levels - self.level(path, number))))

    def stack(self, *clips):
        return {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': f'c{number}', 'media_id': 60, **clip} for number, clip in enumerate(clips)]}]}

    def prepared(self, media_id, steady, backwards, portrait=False):
        facts = self.facts[media_id]
        if steady:
            facts = stabilise_service.ensure_stable(facts)
        if backwards:
            facts = reverse_service.ensure_reversed(facts)
        if portrait:
            choice, amount, pulled = portrait if isinstance(portrait, tuple) else (None, 'medium', None)
            pick = instance_service.from_choice(choice)
            pull = instance_service.from_pull(pulled, pick.kind if pick else 'people')
            finder = FAKE_FINDER if instance_service.is_everyone(pick) and (pull is None or instance_service.is_everyone(pull.to)) else FAKE_INSTANCES
            instance_service.prepare_portrait(facts, pick, amount, lambda _: None, lambda: False, finder=finder, pull=pull)
            facts = probe_video(instance_service.portrait_paths(facts.path, pick, amount, pull)[0])
        return facts

    def test_freeze_holds_one_frame_and_is_silent(self):
        path = self.render(self.stack({'start': 0, 'in': 0, 'out': 1}, {'start': 1, 'in': 0, 'out': 1, 'freeze': 1.5, 'muted': False}), 'freeze.mp4')
        self.assertEqual([self.source_frame(path, number) for number in (35, 45, 58)], [45, 45, 45])
        self.assertLess(self.tone(path, 1.2, 0.6)[1], 0.01)
        self.assertGreater(self.tone(path, 0.2, 0.6)[1], 0.05)

    def test_reverse_plays_in_to_out_backwards(self):
        path = self.render(self.stack({'start': 0, 'in': 1, 'out': 3, 'reverse': True}), 'reverse.mp4', prepared=self.prepared)
        shown = [self.source_frame(path, number) for number in (0, 30, 59)]
        for got, want in zip(shown, (89, 59, 30)):
            self.assertAlmostEqual(got, want, delta=1)
        self.assertFalse(has_stream(path, 'audio'))
        self.assertTrue(reverse_service.is_ready(self.facts[60].path))

    def test_reverse_needs_its_copy(self):
        with self.assertRaises(ValueError):
            self.render(self.stack({'start': 0, 'in': 1, 'out': 3, 'reverse': True}), 'no-copy.mp4')

    def test_flash_goes_white_and_dip_goes_black_in_the_middle(self):
        for kind, check in (('flash', lambda level: self.assertGreater(level, 200)), ('dip', lambda level: self.assertLess(level, 60))):
            with self.subTest(kind=kind):
                path = self.render(self.stack({'start': 0, 'in': 0, 'out': 2}, {'start': 2, 'in': 2, 'out': 4, 'transition_in': {'kind': kind, 'duration': 1}}), f'{kind}.mp4')
                check(self.level(path, 54))

    def test_whip_blurs_sideways_only_during_the_slide(self):
        bars = self.root / 'bars.png'
        picture = np.zeros((180, 320, 3), np.uint8)
        picture[:, ::8] = 255
        Image.fromarray(picture).save(bars)
        self.facts[61] = MediaFacts(path=bars, media_type='image', width=320, height=180)
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [
            {'id': 'a', 'media_id': 61, 'start': 0, 'in': 0, 'out': 2}, {'id': 'b', 'media_id': 61, 'start': 2, 'in': 0, 'out': 2, 'transition_in': {'kind': 'whip', 'duration': 1}}]}]}
        path = self.render(data, 'whip.mp4')
        detail = lambda number: self.frame(path, number, (640, 360))[180, 80:560, 0].std()
        self.assertGreater(detail(10), 60)
        self.assertLess(detail(60), 25)
        self.assertGreater(detail(110), 60)


class Steady(Clips):
    """A slow pan across a detailed picture, with random hand shake on every frame."""
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        rng = np.random.default_rng(7)
        scene = (rng.random((60, 110, 3)) * 255).astype(np.uint8).repeat(8, 0).repeat(8, 1)
        cls.shake = rng.normal(0, 6, (90, 2))
        frames = [scene[int(40 + dy):int(40 + dy) + 360, int(60 + number * 1 + dx):int(60 + number * 1 + dx) + 640] for number, (dx, dy) in enumerate(cls.shake)]
        shaky = cls.root / 'shaky.mp4'
        process = subprocess.Popen([FFMPEG, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '640x360', '-r', '30', '-i', '-', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', str(shaky)], stdin=subprocess.PIPE)
        process.communicate(b''.join(np.ascontiguousarray(frame).tobytes() for frame in frames))
        cls.facts[70] = probe_video(shaky)

    def setUp(self):
        super().setUp()
        self.data = patch.object(settings, 'data_dir', self.out / 'data')
        self.data.start()

    def tearDown(self):
        self.data.stop()
        super().tearDown()

    def jitter(self, path):
        """How far each frame jumps from the last, beyond the smooth pan, in pixels."""
        import cv2
        raw = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True, check=True).stdout
        frames = np.frombuffer(raw, np.uint8).reshape(-1, 360, 640).astype(np.float32)
        steps = np.array([cv2.phaseCorrelate(a[60:300, 100:540], b[60:300, 100:540])[0] for a, b in zip(frames, frames[1:])])
        return float(np.abs(steps - np.median(steps, axis=0)).mean()), len(frames)

    def test_steadying_removes_most_of_the_shake_and_keeps_every_frame(self):
        steady = stabilise_service.ensure_stable(self.facts[70])
        before, count = self.jitter(self.facts[70].path)
        after, steady_count = self.jitter(steady.path)
        self.assertGreater(before, 4)
        self.assertLess(after, before * 0.4)
        self.assertEqual(steady_count, count)
        self.assertTrue(stabilise_service.is_ready(self.facts[70].path))

    def test_export_uses_the_steady_copy_and_can_reverse_it(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 70, 'start': 0, 'in': 0, 'out': 3, 'stabilise': True}]}]}
        prepared = lambda media_id, steady, backwards, portrait=False: QuickEffects.prepared(self, media_id, steady, backwards, portrait)
        path = self.render(data, 'steady.mp4', prepared=prepared)
        self.assertLess(self.jitter(path)[0], self.jitter(self.facts[70].path)[0] * 0.4)
        data['layers'][0]['items'][0]['reverse'] = True
        self.render(data, 'steady-back.mp4', prepared=prepared)
        self.assertTrue(reverse_service.is_ready(stabilise_service.stable_files(self.facts[70].path)[0]))
        with self.assertRaises(ValueError):
            self.render(data, 'unprepared.mp4')


class SpeedRamps(QuickEffects):
    HERO = [{'t': 0, 'v': 1.6}, {'t': 0.35, 'v': 1.6}, {'t': 0.45, 'v': 0.3}, {'t': 0.6, 'v': 0.3}, {'t': 0.7, 'v': 1.6}, {'t': 1, 'v': 1.6}]

    def test_each_frame_shows_the_moment_the_ramp_gives(self):
        from app.services.ramp import ramp_share
        from app.services.timeline_schema import RampPoint
        ramp = [RampPoint(**point) for point in self.HERO]
        path = self.render(self.stack({'start': 0, 'in': 0.5, 'out': 3.5, 'ramp': self.HERO}), 'ramp.mp4')
        self.assertEqual(self.frame_count(path), 90)
        for number in (0, 10, 30, 45, 55, 70, 89):
            want = round((0.5 + ramp_share(ramp, number / 90) * 3) * 30)
            self.assertAlmostEqual(self.source_frame(path, number), want, delta=1, msg=f'frame {number}')
        self.assertFalse(has_stream(path, 'audio'))

    def test_a_ramp_keeps_the_clip_length_and_carries_into_a_transition(self):
        data = self.stack({'start': 0, 'in': 0, 'out': 2}, {'start': 2, 'in': 1, 'out': 3, 'speed': 0.5, 'ramp': self.HERO, 'transition_in': {'kind': 'crossfade', 'duration': 0.6}})
        path = self.render(data, 'ramp-cross.mp4')
        self.assertEqual(self.frame_count(path), 180)

    def test_a_ramp_must_cover_the_whole_clip(self):
        with self.assertRaises(ValidationError):
            Timeline.model_validate(self.stack({'start': 0, 'in': 0, 'out': 2, 'ramp': [{'t': 0, 'v': 1}, {'t': 0.5, 'v': 2}]}))


class Cutout(QuickEffects):
    def setUp(self):
        super().setUp()
        rng = np.random.default_rng(9)
        scene = (rng.random((45, 80, 3)) * 255).astype(np.uint8).repeat(8, 0).repeat(8, 1)
        busy = self.out / 'busy.mp4'
        process = subprocess.Popen([FFMPEG, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '640x360', '-r', '30', '-i', '-', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', str(busy)], stdin=subprocess.PIPE)
        process.communicate(scene.tobytes() * 60)
        self.facts[80] = probe_video(busy)
        red = self.out / 'red.png'
        Image.new('RGB', (640, 360), (220, 30, 30)).save(red)
        self.facts[81] = MediaFacts(path=red, media_type='image', width=640, height=360)

    def masks(self, facts, choice=None):
        pick = instance_service.from_choice(choice)
        if pick and not (pick.kind == 'people' and pick.ids is None):
            instance_service.prepare(facts, pick, lambda _: None, lambda: False, finder=FAKE_INSTANCES)
            return instance_service.pick_paths(facts.path, pick)[0]
        cutout_service.prepare(facts, 'remove', lambda _: None, lambda: False, finder=FAKE_FINDER)
        return cutout_service.files(facts.path)[cutout_service.MASK]

    def detail(self, frame, x, y):
        return frame[y - 15:y + 15, x - 15:x + 15].astype(float).std()

    def test_remove_shows_what_is_under_the_person(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'r', 'media_id': 81, 'start': 0, 'in': 0, 'out': 2}]},
                                                  {'id': 'top', 'kind': 'video', 'items': [{'id': 'p', 'media_id': 80, 'start': 0, 'in': 0, 'out': 2, 'cutout': 'remove'}]}]}
        frame = self.frame(self.render(data, 'cut.mp4', masks=self.masks), 20, (640, 360))
        self.assertGreater(self.detail(frame, 320, 180), 40)
        for got, want in zip(frame[20, 20], (220, 30, 30)):
            self.assertAlmostEqual(int(got), want, delta=12)
        self.assertTrue(cutout_service.is_ready(self.facts[80].path, 'remove'))

    def test_blur_keeps_the_person_sharp_and_softens_the_rest(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'p', 'media_id': 80, 'start': 0, 'in': 0, 'out': 2, 'cutout': 'blur'}]}]}
        frame = self.frame(self.render(data, 'portrait.mp4', prepared=self.prepared), 20, (640, 360))
        original = self.frame(self.facts[80].path, 20, (640, 360))
        self.assertGreater(self.detail(frame, 320, 180), self.detail(original, 320, 180) * 0.85)
        self.assertLess(self.detail(frame, 40, 40), self.detail(original, 40, 40) * 0.6)

    def test_each_one_found_keeps_its_number_and_they_read_left_to_right(self):
        facts = self.facts[80]
        instance_service.prepare(facts, instance_service.Pick('people', None), lambda _: None, lambda: False, finder=FAKE_INSTANCES, joined=False)
        found = instance_service.tracks(facts.path, 'people')
        self.assertEqual([item['label'] for item in found], [1, 2])
        self.assertLess(found[0]['centre'][0], 0.4)
        self.assertGreater(found[1]['centre'][0], 0.6)
        self.assertTrue(instance_service.picture_path(facts.path, 'people').is_file())
        # Though the finder swaps their order every frame, each mask holds one circle throughout.
        for item in found:
            mask = self.frame(instance_service.track_path(facts.path, 'people', item['id']), 31, (640, 360))
            here, there = (160, 480) if item['label'] == 1 else (480, 160)
            self.assertGreater(int(mask[180, here].mean()), 200)
            self.assertLess(int(mask[180, there].mean()), 30)

    def test_only_the_chosen_one_stays_in_front(self):
        facts = self.facts[80]
        instance_service.prepare(facts, instance_service.Pick('people', None), lambda _: None, lambda: False, finder=FAKE_INSTANCES, joined=False)
        right = instance_service.tracks(facts.path, 'people')[1]['id']
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'r', 'media_id': 81, 'start': 0, 'in': 0, 'out': 2}]},
                                                  {'id': 'top', 'kind': 'video', 'items': [{'id': 'p', 'media_id': 80, 'start': 0, 'in': 0, 'out': 2, 'cutout': 'remove', 'cutout_pick': {'kind': 'people', 'ids': [right]}}]}]}
        frame = self.frame(self.render(data, 'pick.mp4', masks=self.masks), 20, (640, 360))
        self.assertGreater(self.detail(frame, 480, 180), 40)
        # The other one is gone: plain red there, the layer underneath.
        for got, want in zip(frame[165:195, 145:175].reshape(-1, 3).mean(axis=0), (220, 30, 30)):
            self.assertAlmostEqual(float(got), want, delta=12)

    def test_choosing_who_stays_needs_the_background_removed(self):
        clip = {'id': 'p', 'media_id': 80, 'start': 0, 'in': 0, 'out': 2, 'cutout_pick': {'kind': 'people', 'ids': [0]}}
        with self.assertRaises(ValidationError):
            Timeline.model_validate({'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [clip]}]})
        self.assertEqual(instance_service.parse('people-2-0'), instance_service.Pick('people', (0, 2)))
        self.assertEqual(instance_service.parse('objects-all'), instance_service.Pick('objects', None))
        for wrong in ('people', 'people-', 'cars-1', 'people-9', 'people-x'):
            self.assertIsNone(instance_service.parse(wrong))

    def test_blur_can_keep_only_the_chosen_one_sharp_and_be_stronger(self):
        facts = self.facts[80]
        instance_service.prepare(facts, instance_service.Pick('people', None), lambda _: None, lambda: False, finder=FAKE_INSTANCES, joined=False)
        right = instance_service.tracks(facts.path, 'people')[1]['id']
        original = self.frame(facts.path, 20, (640, 360))
        frames = {}
        for amount in ('subtle', 'strong'):
            clip = {'id': 'p', 'media_id': 80, 'start': 0, 'in': 0, 'out': 2, 'cutout': 'blur', 'cutout_pick': {'kind': 'people', 'ids': [right]}, 'blur_amount': amount}
            data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [clip]}]}
            frames[amount] = self.frame(self.render(data, f'focus-{amount}.mp4', prepared=self.prepared), 20, (640, 360))
        strong = frames['strong']
        self.assertGreater(self.detail(strong, 480, 180), self.detail(original, 480, 180) * 0.85)  # The chosen one stays sharp...
        self.assertLess(self.detail(strong, 160, 180), self.detail(original, 160, 180) * 0.5)  # ...the other one goes soft with the background.
        self.assertLess(self.detail(strong, 40, 40), self.detail(frames['subtle'], 40, 40))
        self.assertEqual(instance_service.parse_cutout('blur.people-1.strong'), ('blur', instance_service.Pick('people', (1,)), 'strong', None))
        self.assertEqual(instance_service.parse_cutout('blur.all.subtle'), ('blur', None, 'subtle', None))
        for wrong in ('blur.people-1', 'blur.people-1.huge', 'blur.cars-1.strong', 'blur..strong', 'cut'):
            self.assertIsNone(instance_service.parse_cutout(wrong))

    def test_a_focus_pull_moves_the_sharp_one_part_way_through(self):
        facts = self.facts[80]
        instance_service.prepare(facts, instance_service.Pick('people', None), lambda _: None, lambda: False, finder=FAKE_INSTANCES, joined=False)
        left, right = [item['id'] for item in instance_service.tracks(facts.path, 'people')]
        clip = {'id': 'p', 'media_id': 80, 'start': 0, 'in': 0, 'out': 2, 'cutout': 'blur', 'blur_amount': 'strong', 'cutout_pick': {'kind': 'people', 'ids': [left]},
                'focus_pull': {'to': [right], 'at': 0.8, 'length': 0.4}}
        path = self.render({'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [clip]}]}, 'pull.mp4', prepared=self.prepared)
        original = self.frame(facts.path, 10, (640, 360))
        sharp = lambda frame, x: self.detail(frame, x, 180) / self.detail(original, x, 180)
        early, late = self.frame(path, 10, (640, 360)), self.frame(path, 50, (640, 360))
        self.assertGreater(sharp(early, 160), 0.85)
        self.assertLess(sharp(early, 480), 0.5)
        self.assertGreater(sharp(late, 480), 0.85)
        self.assertLess(sharp(late, 160), 0.5)
        middle = self.frame(path, 30, (640, 360))  # Half way: both partly soft.
        self.assertLess(sharp(middle, 160), sharp(early, 160))
        self.assertLess(sharp(middle, 480), sharp(late, 480))
        token = 'blur.people-0.strong.people-1@800+400'
        self.assertEqual(instance_service.parse_cutout(token), ('blur', instance_service.Pick('people', (0,)), 'strong', instance_service.Pull(instance_service.Pick('people', (1,)), 800, 400)))
        for wrong in ('blur.people-0.strong.people-1@800', 'blur.people-0.strong.people-1@800+50', 'blur.people-0.strong.cars@1+400', 'blur.all.strong.x.y'):
            self.assertIsNone(instance_service.parse_cutout(wrong))
        with self.assertRaises(ValidationError):
            Timeline.model_validate({'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{**clip, 'cutout': 'remove'}]}]})

    def test_without_its_mask_a_cut_out_clip_is_refused(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'p', 'media_id': 80, 'start': 0, 'in': 0, 'out': 2, 'cutout': 'remove'}]}]}
        with self.assertRaises(ValueError):
            self.render(data, 'no-mask.mp4')


class Captions(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    def stack(self, highlight='#ffd400', words=None):
        grey = self.root / 'grey-captions.png'
        Image.new('RGB', (640, 360), (60, 60, 60)).save(grey)
        self.facts[90] = MediaFacts(path=grey, media_type='image', width=640, height=360)
        caption = {'id': 'c1', 'start': 0.5, 'length': 1.5, 'words': words or [{'w': 'ONE', 's': 0}, {'w': 'TWO', 's': 0.5}, {'w': 'THREE', 's': 1.0}]}
        return {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 90, 'start': 0, 'in': 0, 'out': 2.5}]},
                                                  {'id': 'subs', 'kind': 'captions', 'highlight': highlight, 'size': 60, 'items': [caption]}]}

    def yellow(self, frame):
        """Pixels of the highlight colour: bright red and green, little blue."""
        return int(((frame[:, :, 0] > 200) & (frame[:, :, 1] > 170) & (frame[:, :, 2] < 90)).sum())

    def white(self, frame):
        return int(((frame[:, :, 0] > 220) & (frame[:, :, 1] > 220) & (frame[:, :, 2] > 220)).sum())

    def test_the_spoken_word_lights_up_and_moves_along(self):
        path = self.render(self.stack(), 'captions.mp4')
        before, first, second, after = (self.frame(path, number, (640, 360)) for number in (5, 20, 35, 70))
        self.assertEqual(self.white(before) + self.yellow(before), 0)
        self.assertGreater(self.yellow(first), 50)
        self.assertGreater(self.white(first), 50)
        self.assertGreater(self.yellow(second), 50)
        # A different word is lit: the yellow moves to the right of where it was.
        columns = lambda frame: np.nonzero(((frame[:, :, 0] > 200) & (frame[:, :, 1] > 170) & (frame[:, :, 2] < 90)).any(axis=0))[0].mean()
        self.assertGreater(columns(second), columns(first))
        self.assertEqual(self.white(after) + self.yellow(after), 0)

    def test_without_highlight_every_word_is_plain(self):
        frame = self.frame(self.render(self.stack(highlight=None), 'plain.mp4'), 35, (640, 360))
        self.assertEqual(self.yellow(frame), 0)
        self.assertGreater(self.white(frame), 100)

    def test_words_must_stay_inside_their_caption(self):
        with self.assertRaises(ValidationError):
            Timeline.model_validate(self.stack(words=[{'w': 'late', 's': 2}]))


@unittest.skipUnless(shutil.which('say'), "needs the Mac's voice")
class CleanVoice(QuickEffects):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        speech = cls.root / 'speech.aiff'
        subprocess.run(['say', '-o', str(speech), 'Hello there. [[slnc 1200]] This is a test of clean voice. [[slnc 1200]] Thank you.'], check=True)
        noisy = cls.root / 'noisy-talk.mp4'
        run('-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=7', '-i', str(speech), '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.05:d=7',
            '-filter_complex', '[1:a]aresample=48000,apad[v];[2:a]aresample=48000[n];[v][n]amix=inputs=2:normalize=0,atrim=end=6.5[a]', '-map', '0:v', '-map', '[a]', '-t', '6.5',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '192k', str(noisy))
        cls.facts[95] = probe_video(noisy)
        cls.speech = speech

    def samples(self, path):
        raw = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.float32).astype(float)

    def test_noise_goes_down_the_voice_stays_and_nothing_moves(self):
        data = {'format': {'width': 320, 'height': 240, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 95, 'start': 0, 'in': 0, 'out': 6.5}]}]}
        before = self.samples(self.render(data, 'before.mp4'))
        data['layers'][0]['items'][0]['clean_voice'] = True
        after = self.samples(self.render(data, 'after.mp4', voices=voice_service.ensure_clean))
        voice = self.samples(self.speech)
        voice = np.pad(voice, (0, max(0, len(before) - len(voice))))[:len(before)]
        frames = len(before) // 800
        level = lambda x: np.sqrt((x[:frames * 800].reshape(frames, 800) ** 2).mean(axis=1)) + 1e-9
        talk, quiet = level(voice) > 0.02, level(voice) < 0.0005
        db = lambda x, where: 20 * np.log10(np.sqrt((level(x)[where] ** 2).mean()))
        self.assertGreater(db(before, quiet) - db(after, quiet), 12, 'the gaps between words are much quieter')
        self.assertLess(abs(db(after, talk) - db(before, talk)), 6, 'the voice keeps its level')
        corr = np.fft.irfft(np.fft.rfft(before, 2 ** 18) * np.conj(np.fft.rfft(after, 2 ** 18)))
        lag = int(np.argmax(np.concatenate([corr[-800:], corr[:800]]))) - 800
        self.assertLessEqual(abs(lag), 16, f'in sync with the picture: {lag} samples at 16 kHz')

    def test_without_its_cleaned_copy_the_clip_is_refused(self):
        data = {'format': {'width': 320, 'height': 240, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 95, 'start': 0, 'in': 0, 'out': 6.5, 'clean_voice': True}]}]}
        with self.assertRaises(ValueError):
            self.render(data, 'no-copy.mp4')


class BehindShape(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    def test_the_title_hides_behind_the_drawn_part_only(self):
        scene = self.root / 'hills.png'
        Image.new('RGB', (640, 360), (40, 90, 50)).save(scene)
        self.facts[97] = MediaFacts(path=scene, media_type='image', width=640, height=360)
        title = {'id': 't', 'start': 0, 'length': 1, 'text': 'MOUNTAINS', 'style': 'shadow', 'position': 'center', 'size': 90, 'color': '#ffffff'}
        front = {'id': 'f', 'media_id': 97, 'start': 0, 'in': 0, 'out': 1, 'muted': True, 'shape_mask': {'points': [[0, 0], [0.5, 0], [0.5, 1], [0, 1]], 'feather': 0}}
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 97, 'start': 0, 'in': 0, 'out': 1}]},
                                                  {'id': 'words', 'kind': 'text', 'items': [title]}, {'id': 'front', 'kind': 'video', 'items': [front]}]}
        frame = self.frame(self.render(data, 'behind.mp4'), 10, (640, 360))
        white = (frame > 200).all(axis=2)
        self.assertEqual(int(white[:, :310].sum()), 0, 'hidden on the left, behind the drawn part')
        self.assertGreater(int(white[:, 330:].sum()), 200, 'seen on the right')
        for got, want in zip(frame[180, 100], (40, 90, 50)):
            self.assertAlmostEqual(int(got), want, delta=8)

    def test_a_shape_must_stay_on_the_frame(self):
        with self.assertRaises(ValidationError):
            Timeline.model_validate({'layers': [{'id': 'v', 'kind': 'video', 'items': [{'id': 'c', 'media_id': 1, 'start': 0, 'out': 1, 'shape_mask': {'points': [[0, 0], [3, 0], [0, 1]]}}]}]})


class TitleTemplates(unittest.TestCase):
    def draw(self, **look):
        from app.services.timeline_schema import Format, Text
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'title.png'
            render_text_image(Text(id='t', start=0, length=1, **look), Format(width=640, height=360, fps=30), target)
            return np.array(Image.open(target).convert('RGBA'))

    def rows(self, picture):
        lit = np.nonzero(picture[:, :, 3].max(axis=1) > 128)[0]
        return lit.min(), lit.max()

    def test_a_plain_title_draws_exactly_as_before(self):
        from app.services.timeline_schema import Text
        self.assertFalse(Text(id='t', start=0, length=1, text='Hi', subtitle_spacing=4).designed)
        plain = self.draw(text='Hello', style='band', position='bottom', size=44)
        again = self.draw(text='Hello', style='band', position='bottom', size=44, subtitle_spacing=4)
        self.assertTrue((plain == again).all())

    def test_a_subtitle_adds_a_smaller_second_line_in_its_own_colour(self):
        alone = self.draw(text='TITLE', style='outline', position='center', size=60, align='left')
        both = self.draw(text='TITLE', subtitle='small line', subtitle_color='#ff0000', style='outline', position='center', size=60, align='left')
        self.assertGreater(self.rows(both)[1] - self.rows(both)[0], (self.rows(alone)[1] - self.rows(alone)[0]) * 1.4)
        red = (both[:, :, 0] > 200) & (both[:, :, 1] < 60) & (both[:, :, 3] > 200)
        self.assertGreater(int(red.sum()), 50)
        self.assertLess(np.nonzero(red.any(axis=1))[0].min(), self.rows(both)[1] + 1)

    def test_alignment_moves_the_block(self):
        columns = lambda picture: np.nonzero(picture[:, :, 3].max(axis=0) > 128)[0]
        left, right = self.draw(text='EDGE', align='left', style='shadow'), self.draw(text='EDGE', align='right', style='shadow')
        self.assertLess(columns(left).max(), 320)
        self.assertGreater(columns(right).min(), 320)

    def test_fonts_change_their_own_script_only(self):
        plain = self.draw(text='Dream கனவு', subtitle='கனவு', style='shadow')
        english = self.draw(text='Dream கனவு', subtitle='கனவு', style='shadow', font='Georgia')
        tamil = self.draw(text='Dream கனவு', subtitle='கனவு', style='shadow', tamil_font='Arima')
        self.assertFalse((plain == english).all(), 'an English font changes the English line')
        self.assertFalse((plain == tamil).all(), 'a Tamil font changes the Tamil line')
        tamil_only = self.draw(text='கனவு வணக்கம்', style='shadow', align='left')
        self.assertTrue((tamil_only == self.draw(text='கனவு வணக்கம்', style='shadow', align='left', font='Georgia')).all(), 'Tamil text ignores the English font')

    def test_font_names_cannot_carry_formatting(self):
        from app.services.timeline_schema import Text
        with self.assertRaises(ValidationError):
            Text(id='t', start=0, length=1, text='x', font='Futura}{\\fs300')

    def test_every_bundled_tamil_font_is_found(self):
        bundled = self.draw(text='கனவு', style='shadow', tamil_font='Noto Sans Tamil')
        for family in ('Arima', 'Kavivanar', 'Baloo Thambi 2', 'Catamaran', 'Pavanam', 'Hind Madurai'):
            with self.subTest(family=family):
                self.assertFalse((self.draw(text='கனவு', style='shadow', tamil_font=family) == bundled).all())

    def test_typed_text_cannot_become_formatting(self):
        picture = self.draw(text='{\\fs200}A', subtitle='{\\c&H0000FF&}b', style='shadow')
        self.assertLess(self.rows(picture)[1] - self.rows(picture)[0], 200)



class CinematicFinish(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    def setUp(self):
        super().setUp()
        picture = np.full((360, 640, 3), 40, np.uint8)
        picture[:, 320:] = 210
        picture[160:200, 140:180] = 255  # A bright patch in the dark half, for the glow.
        path = self.root / 'finish-scene.png'
        Image.fromarray(picture).save(path)
        self.facts[95] = MediaFacts(path=path, media_type='image', width=640, height=360)

    def scene(self, finish=None):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 95, 'start': 0, 'in': 0, 'out': 1}]}]}
        if finish:
            data['finish'] = finish
        return self.frame(self.render(data, f"finish-{len(str(finish))}-{hash(str(finish)) & 0xffff}.mp4"), 10, (640, 360))

    def test_each_part_of_the_finish_does_its_job(self):
        plain = self.scene()
        bars = self.scene({'letterbox': True})
        share = round((1 - (640 / 360) / 2.39) / 2 * 360)
        self.assertLess(bars[share // 2, 480].max(), 10)
        self.assertLess(bars[360 - share // 2, 480].max(), 10)
        self.assertAlmostEqual(int(bars[180, 480].mean()), int(plain[180, 480].mean()), delta=4)
        graded = self.scene({'grade': 1})
        dark, bright = graded[100, 60], graded[100, 560]
        self.assertGreater(dark[2] - dark[0], plain[100, 60][2] - plain[100, 60][0] + 8)  # Teal in the shadows.
        self.assertGreater(bright[0] - bright[2], plain[100, 560][0] - plain[100, 560][2] + 8)  # Orange in the light.
        dimmed = self.scene({'vignette': 1})
        self.assertLess(dimmed[5, 635].mean(), plain[5, 635].mean() * 0.4)
        self.assertAlmostEqual(dimmed[180, 330].mean(), plain[180, 330].mean(), delta=4)
        glowing = self.scene({'glow': 1})
        self.assertGreater(glowing[180, 186].mean(), plain[180, 186].mean() + 15)  # Light spills past the patch's edge.
        grainy = self.scene({'grain': 1})
        self.assertGreater(grainy[20:80, 20:120].std(), plain[20:80, 20:120].std() + 3)

    def test_captions_stay_above_the_finish(self):
        data = {'format': self.FORMAT, 'finish': {'letterbox': True, 'vignette': 1},
                'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 95, 'start': 0, 'in': 0, 'out': 1}]},
                           {'id': 'subs', 'kind': 'captions', 'size': 60, 'items': [{'id': 'c', 'start': 0, 'length': 1, 'words': [{'w': 'HELLO', 's': 0}]}]}]}
        compiled_order = self.render(data, 'finish-captions.mp4')
        self.assertTrue(compiled_order.is_file())
        from app.services.timeline_service import compile_timeline
        graph = compile_timeline(Timeline.model_validate(data), self.facts.__getitem__, lambda asset: self.root / asset, self.out).graph
        self.assertLess(graph.index('blend=all_mode=multiply'), graph.index('subtitles=') if 'subtitles=' in graph else graph.index('ass='))


class EffectSwitches(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    def setUp(self):
        super().setUp()
        picture = np.zeros((360, 640, 3), np.uint8)
        picture[:, :] = (220, 40, 40)
        picture[150:210, 290:350] = (40, 200, 60)
        path = self.root / 'switch-scene.png'
        Image.fromarray(picture).save(path)
        self.facts[96] = MediaFacts(path=path, media_type='image', width=640, height=360)

    def shot(self, name, **clip):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 96, 'start': 0, 'in': 0, 'out': 1, **clip}]}]}
        return self.frame(self.render(data, name), 15, (640, 360))

    def test_a_switched_off_effect_is_left_out_of_the_export_and_kept_in_the_timeline(self):
        plain = self.shot('switch-plain.mp4')
        mono = self.shot('switch-mono.mp4', look='mono')
        off = self.shot('switch-mono-off.mp4', look='mono', bypass=['look'])
        self.assertGreater(abs(int(plain[50, 50, 0]) - int(mono[50, 50, 0])), 40)  # Mono takes the red away...
        self.assertLess(np.abs(off.astype(int) - plain.astype(int)).mean(), 2)  # ...and switched off, the clip is as it was.
        keyed = self.shot('switch-key.mp4', chroma={'color': '#28c83c', 'similarity': 0.2, 'softness': 0.05, 'spill': 0})
        unkeyed = self.shot('switch-key-off.mp4', chroma={'color': '#28c83c', 'similarity': 0.2, 'softness': 0.05, 'spill': 0}, bypass=['green_screen'])
        self.assertLess(keyed[180, 320].max(), 30)  # The green patch is keyed out to black...
        self.assertGreater(int(unkeyed[180, 320, 1]), 150)  # ...and comes back with the green screen switched off.
        moving = {'transform': {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0, 'keyframes': {'x': [{'t': 0, 'v': 0.2}, {'t': 1, 'v': 0.8}]}}}
        still = self.shot('switch-motion-off.mp4', bypass=['motion'], **moving)
        self.assertLess(np.abs(still.astype(int) - plain.astype(int)).mean(), 2)
        old_film = {'intensity': 0.8, 'grain': 0.7, 'scratches': 0.6, 'dust': 0.5, 'weave': 0.4}
        aged = self.shot('switch-old-film.mp4', old_film=old_film)
        clean_again = self.shot('switch-old-film-off.mp4', old_film=old_film, bypass=['old_film'])
        self.assertGreater(np.abs(aged.astype(int) - plain.astype(int)).mean(), 2)
        self.assertLess(np.abs(clean_again.astype(int) - plain.astype(int)).mean(), 2)
        signal = {'mode': 'vhs', 'intensity': 0.9, 'rgb_split': 0.8, 'jitter': 0.7, 'scanlines': 0.7, 'noise': 0.6}
        damaged = self.shot('switch-signal.mp4', signal_damage=signal)
        signal_off = self.shot('switch-signal-off.mp4', signal_damage=signal, bypass=['signal_damage'])
        self.assertGreater(np.abs(damaged.astype(int) - plain.astype(int)).mean(), 2)
        self.assertLess(np.abs(signal_off.astype(int) - plain.astype(int)).mean(), 2)
        lens = {'mode': 'raindrops', 'intensity': 0.9, 'amount': 0.7, 'refraction': 0.8, 'softness': 0.4}
        wet = self.shot('switch-lens.mp4', lens_surface=lens)
        dry = self.shot('switch-lens-off.mp4', lens_surface=lens, bypass=['lens_surface'])
        self.assertGreater(np.abs(wet.astype(int) - plain.astype(int)).mean(), 1)
        self.assertLess(np.abs(dry.astype(int) - plain.astype(int)).mean(), 2)
        splash = {'color': '#d52836', 'intensity': 1, 'tolerance': 0.12, 'softness': 0.08}
        selective = self.shot('switch-colour-splash.mp4', colour_splash=splash)
        splash_off = self.shot('switch-colour-splash-off.mp4', colour_splash=splash, bypass=['colour_splash'])
        self.assertGreater(np.abs(selective.astype(int) - plain.astype(int)).mean(), 1)
        self.assertLess(np.abs(splash_off.astype(int) - plain.astype(int)).mean(), 2)
        dreamy = {'intensity': 0.8, 'softness': 0.7, 'warmth': 0.5}
        glowing = self.shot('switch-dreamy-glow.mp4', dreamy_glow=dreamy)
        glow_off = self.shot('switch-dreamy-glow-off.mp4', dreamy_glow=dreamy, bypass=['dreamy_glow'])
        self.assertGreater(np.abs(glowing.astype(int) - plain.astype(int)).mean(), 1)
        self.assertLess(np.abs(glow_off.astype(int) - plain.astype(int)).mean(), 2)
        pulse = {'strength': 1, 'size': 0.12, 'bpm': 120, 'offset': 0}
        pulsing = self.shot('switch-beat-pulse.mp4', beat_pulse=pulse)
        pulse_off = self.shot('switch-beat-pulse-off.mp4', beat_pulse=pulse, bypass=['beat_pulse'])
        self.assertGreater(np.abs(pulsing.astype(int) - plain.astype(int)).mean(), 0.3)
        self.assertLess(np.abs(pulse_off.astype(int) - plain.astype(int)).mean(), 2)
        saved = Timeline.model_validate({'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'items': [{'id': 'a', 'media_id': 96, 'start': 0, 'in': 0, 'out': 1, 'look': 'mono', 'bypass': ['look']}]}]})
        self.assertEqual(saved.layers[0].items[0].look, 'mono')

    def test_a_switched_off_background_needs_no_person_mask(self):
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1, 'cutout': 'remove', 'bypass': ['background']}]}]}
        self.assertTrue(self.render(data, 'switch-background-off.mp4').is_file())  # No masks callback: it would raise if a mask were needed.


class NewVideoProjects(Clips):
    def setUp(self):
        super().setUp()
        self.patches = [patch.object(settings, 'data_dir', self.out / 'data'), patch.object(settings, 'edit_workspace_dir', self.out / 'data' / 'exports'), patch.object(settings, 'thumbnail_dir', self.out / 'data' / 'thumbnails')]
        for item in self.patches:
            item.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches):
            item.stop()
        super().tearDown()

    def upload(self, name, data, kind):
        return self.client.post('/api/media', files={'file': (name, data, kind)}).json()

    def test_a_video_project_can_start_blank_or_with_clips_and_photos_in_order(self):
        blank = self.client.post('/api/projects', json={'name': 'Empty', 'kind': 'edit'})
        self.assertEqual(blank.status_code, 200, blank.text)
        timeline = self.client.get(f"/api/projects/{blank.json()['id']}/timeline").json()
        self.assertEqual(timeline['layers'][0]['items'], [])
        self.assertNotIn('fresh', timeline)
        self.assertTrue(self.client.get(f"/api/projects/{blank.json()['id']}").json()['recipe']['fresh'])
        again = self.client.post('/api/projects', json={'name': 'Empty 2', 'kind': 'edit'}).json()
        self.assertEqual(again['media_id'], blank.json()['media_id'])  # One shared stand-in, not a new canvas each time.

        video = self.upload('red.mp4', (self.root / 'red.mp4').read_bytes(), 'video/mp4')
        picture = io.BytesIO()
        Image.new('RGB', (640, 360), (0, 0, 255)).save(picture, 'PNG')
        photo = self.upload('blue.png', picture.getvalue(), 'image/png')
        mixed = self.client.post('/api/projects', json={'name': 'Mixed', 'kind': 'edit', 'media_id': photo['id'], 'media_ids': [photo['id'], video['id']]}).json()
        timeline = self.client.get(f"/api/projects/{mixed['id']}/timeline").json()
        items = timeline['layers'][0]['items']
        self.assertEqual([item['media_id'] for item in items], [photo['id'], video['id']])
        self.assertEqual([item['start'] for item in items], [0, 5])
        self.assertEqual(items[0]['out'], 5)
        self.assertAlmostEqual(items[1]['out'], video['duration'], delta=0.05)
        self.assertEqual((timeline['format']['width'], timeline['format']['height']), (640, 360))
        Timeline.model_validate(timeline)  # A valid timeline, ready to edit and export.


class CaptionPlaces(Clips):
    FORMAT = {'width': 640, 'height': 360, 'fps': 30}

    def test_one_caption_can_move_to_the_top_and_the_preview_image_agrees(self):
        captions = [{'id': 'low', 'start': 0, 'length': 1, 'words': [{'w': 'HELLO', 's': 0}]},
                    {'id': 'high', 'start': 1, 'length': 1, 'words': [{'w': 'HELLO', 's': 0}], 'position': 'top'}]
        data = {'format': self.FORMAT, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'a', 'media_id': 6, 'start': 0, 'in': 0, 'out': 2}]},
                                                   {'id': 'subs', 'kind': 'captions', 'size': 60, 'highlight': None, 'items': captions}]}
        target = self.render(data, 'caption-places.mp4')

        def white_rows(picture):
            rows = np.where((picture.min(axis=2) > 225).sum(axis=1) > 3)[0]
            self.assertTrue(len(rows), 'the caption is drawn')
            return rows.mean() / picture.shape[0]
        self.assertGreater(white_rows(self.frame(target, 15, (640, 360))), 0.6, 'the layer puts captions at the bottom')
        self.assertLess(white_rows(self.frame(target, 45, (640, 360))), 0.4, 'this caption moved to the top')
        with self.assertRaises(ValidationError):
            Timeline.model_validate({**data, 'layers': [data['layers'][0], {**data['layers'][1], 'items': [{**captions[1], 'position': 'left'}]}]})
