import io
import json
import os
import re
import shutil
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
from app.services import asset_service, render_queue_service, stem_service
from app.services.animation import LOOKS, look_at
from app.services.asset_service import make_proxy
from app.services.job_service import JobCancelled, get_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.timeline_schema import Timeline, Transform, value_at
from app.services.video_edit_service import resolve_audio_asset
from app.services.timeline_service import atempo_chain, property_expression, render_timeline, upgrade_edit_recipe
from app.services.video_service import _run_ffprobe

FFMPEG = shutil.which('ffmpeg')


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


class Api(Clips):
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
