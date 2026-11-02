import hashlib
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.schemas import VideoEditRequest
from app.core.config import settings
from app.main import app
from app.services.video_edit_service import LYRIC_FONTS_DIR, inspect_editable_video, lyric_font_for, render_video_copy, video_filters, write_lyrics
from app.services.video_service import _run_ffprobe


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg tools required')
class VideoEditingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        cls.source = Path(cls.fixture.name) / 'source.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264',
                        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'creation_time=2024-07-08T12:34:56Z', str(cls.source)],
                       check=True, capture_output=True, timeout=30)
        cls.original_hash = hashlib.sha256(cls.source.read_bytes()).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)

    def tearDown(self):
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.original_hash)
        self.folder.cleanup()

    def test_trim_rotate_mute_and_metadata(self):
        edit = VideoEditRequest(trim_start=0.5, trim_end=1.5, rotation=90, flip_horizontal=True, brightness=1.1, contrast=1.2, saturation=0.8, mute=True)
        duration = inspect_editable_video(self.source, edit)
        output = self.root / 'result.mp4'
        progress = []
        render_video_copy(self.source, output, edit, duration, progress.append)
        info = _run_ffprobe(output)
        video = next(s for s in info['streams'] if s['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height']), (240, 320))
        self.assertEqual(video['codec_name'], 'h264')
        self.assertEqual(video['pix_fmt'], 'yuv420p')
        self.assertAlmostEqual(float(info['format']['duration']), 1.0, delta=0.15)
        self.assertFalse(any(s['codec_type'] == 'audio' for s in info['streams']))
        self.assertIn('2024-07-08', info['format']['tags']['creation_time'])
        self.assertTrue(progress)
        self.assertFalse(list(self.root.glob('.video-export-*')))

    def test_audio_survives_and_volume_changes(self):
        import numpy as np
        output = self.root / 'audio.mp4'
        edit = VideoEditRequest(trim_end=2, volume=0.5)
        render_video_copy(self.source, output, edit, inspect_editable_video(self.source, edit), lambda _: None)
        info = _run_ffprobe(output)
        self.assertTrue(any(s.get('codec_name') == 'aac' for s in info['streams']))
        def rms(path):
            result = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(path), '-t', '1', '-vn', '-f', 'f32le', '-ac', '1', '-'], capture_output=True, check=True, timeout=10)
            samples = np.frombuffer(result.stdout, dtype=np.float32)
            return float(np.sqrt(np.mean(samples ** 2)))
        self.assertAlmostEqual(rms(output) / rms(self.source), 0.5, delta=0.1)

    def test_silent_video_and_recorded_rotation(self):
        rotated = self.root / 'rotated.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-display_rotation', '90', '-i', str(self.source), '-an', '-c:v', 'copy', str(rotated)], check=True, capture_output=True, timeout=10)
        edit = VideoEditRequest(trim_end=1)
        target = self.root / 'upright.mp4'
        render_video_copy(rotated, target, edit, inspect_editable_video(rotated, edit), lambda _: None)
        info = _run_ffprobe(target)
        video = next(stream for stream in info['streams'] if stream['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height']), (240, 320))
        self.assertFalse(any(stream['codec_type'] == 'audio' for stream in info['streams']))
        for side in video.get('side_data_list', []):
            self.assertEqual(side.get('rotation', 0), 0)

    def test_brightness_changes_exported_pixels(self):
        import numpy as np
        target = self.root / 'darker.mp4'
        edit = VideoEditRequest(trim_end=1, brightness=0.5, mute=True)
        render_video_copy(self.source, target, edit, 1, lambda _: None)
        def mean(path):
            frame = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(path), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], check=True, capture_output=True, timeout=10)
            return float(np.frombuffer(frame.stdout, dtype=np.uint8).mean())
        self.assertLess(mean(target), mean(self.source) * 0.7)

    def test_lyrical_video_burns_captions_and_loops_background(self):
        import numpy as np
        asset_id = 'a' * 32
        audio = self.root / 'video_audio' / asset_id
        audio.parent.mkdir()
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '5', '-f', 'wav', str(audio)], check=True, capture_output=True, timeout=10)
        edit = VideoEditRequest(audio_asset_id=asset_id, trim_end=5, canvas='portrait', lyric_position='center', lyrics=[{'start': 0.2, 'end': 2.5, 'text': 'Morning light'}, {'start': 3, 'end': 4.8, 'text': 'தமிழ் பாடல்'}])
        with patch.object(settings, 'data_dir', self.root):
            duration = inspect_editable_video(self.source, edit)
            result = self.root / 'lyrical.mp4'
            render_video_copy(self.source, result, edit, duration, lambda _: None)
            baseline = self.root / 'baseline.mp4'
            render_video_copy(self.source, baseline, edit.model_copy(update={'lyrics': []}), duration, lambda _: None)
        info = _run_ffprobe(result)
        video = next(stream for stream in info['streams'] if stream['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height']), (720, 1280))
        self.assertAlmostEqual(float(info['format']['duration']), 5, delta=0.15)
        self.assertTrue(any(stream['codec_type'] == 'audio' for stream in info['streams']))
        decoded = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(result), '-t', '1', '-vn', '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'], check=True, capture_output=True, timeout=10)
        samples = np.frombuffer(decoded.stdout, dtype=np.float32)
        frequency = np.argmax(np.abs(np.fft.rfft(samples))) * 16000 / len(samples)
        self.assertAlmostEqual(frequency, 660, delta=5)
        def frame(path):
            data = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-ss', '1', '-i', str(path), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], check=True, capture_output=True, timeout=10)
            return np.frombuffer(data.stdout, dtype=np.uint8).reshape(1280, 720, 3).astype(float)
        difference = np.abs(frame(result)[550:750] - frame(baseline)[550:750])
        self.assertGreater(int((difference > 80).sum()), 200)
        with patch.object(settings, 'data_dir', self.root):
            with self.assertRaises(ValueError):
                inspect_editable_video(self.source, edit.model_copy(update={'lyrics': [type(edit.lyrics[0])(start=0, end=6, text='Too late')]}))

    def test_photo_background_can_become_a_lyrical_video(self):
        from PIL import Image
        photo = self.root / 'background.jpg'
        Image.new('RGB', (200, 120), 'navy').save(photo)
        before = photo.read_bytes()
        asset_id = 'b' * 32
        audio = self.root / 'video_audio' / asset_id
        audio.parent.mkdir()
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(self.source), '-vn', '-t', '1', '-f', 'wav', str(audio)], check=True, capture_output=True, timeout=10)
        edit = VideoEditRequest(audio_asset_id=asset_id, trim_end=1, canvas='square', lyrics=[{'start': 0, 'end': 1, 'text': 'Morning light'}])
        with patch.object(settings, 'data_dir', self.root):
            duration = inspect_editable_video(photo, edit, background_is_image=True)
            result = self.root / 'photo-video.mp4'
            render_video_copy(photo, result, edit, duration, lambda _: None, background_is_image=True)
        info = _run_ffprobe(result)
        video = next(stream for stream in info['streams'] if stream['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height']), (720, 720))
        self.assertAlmostEqual(float(info['format']['duration']), 1, delta=.15)
        self.assertEqual(photo.read_bytes(), before)

    def test_slideshow_order_animation_and_duration(self):
        from PIL import Image, ImageDraw
        import numpy as np
        images = []
        for index, color in enumerate(['red', 'blue']):
            path = self.root / f'{index}.png'
            image = Image.new('RGB', (160, 160), color)
            ImageDraw.Draw(image).rectangle((60, 60, 100, 100), fill='white')
            image.save(path)
            images.append((path, {}))
        asset_id = 'c' * 32
        audio = self.root / 'video_audio' / asset_id
        audio.parent.mkdir()
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(self.source), '-vn', '-t', '2', '-f', 'wav', str(audio)], check=True, capture_output=True)
        def frame(path, time):
            data = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-ss', str(time), '-i', str(path), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], check=True, capture_output=True)
            return np.frombuffer(data.stdout, dtype=np.uint8).reshape(720, 720, 3).astype(float)
        with patch.object(settings, 'data_dir', self.root):
            for animation in ['none', 'zoom-in', 'pan-left']:
                edit = VideoEditRequest(audio_asset_id=asset_id, canvas='square', trim_end=2, image_animation=animation)
                output = self.root / f'{animation}.mp4'
                render_video_copy(images[0][0], output, edit, 2, lambda _: None, background_is_image=True, backgrounds=images)
                self.assertAlmostEqual(float(_run_ffprobe(output)['format']['duration']), 2, delta=.1)
                first, last = frame(output, .1), frame(output, 1.5)
                self.assertGreater(first[:, :, 0].mean(), first[:, :, 2].mean() + 100)
                self.assertGreater(last[:, :, 2].mean(), last[:, :, 0].mean() + 100)
                if animation != 'none':
                    self.assertGreater(np.abs(first - frame(output, .85)).mean(), .5)
                self.assertTrue(any(stream['codec_type'] == 'audio' for stream in _run_ffprobe(output)['streams']))
        self.assertFalse(list(self.root.glob('.video-export-*')))

    def render_lyric_frame(self, text, *, shaping='complex'):
        """One frame of white lyric text on black, through the real ASS writer."""
        import numpy as np
        edit = VideoEditRequest(canvas='landscape', lyric_position='center', lyrics=[{'start': 0, 'end': 1, 'text': text}])
        folder = self.root / f'frame-{shaping}-{abs(hash(text))}'
        folder.mkdir()
        write_lyrics(folder / 'lyrics.ass', edit, self.source)
        (folder / 'fonts').symlink_to(LYRIC_FONTS_DIR)
        result = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=1280x720:d=0.5:r=2', '-vf', f'ass=filename=lyrics.ass:shaping={shaping}:fontsdir=fonts',
                                 '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], cwd=folder, check=True, capture_output=True, timeout=20)
        return np.frombuffer(result.stdout, dtype=np.uint8).reshape(720, 1280)

    def test_indic_lyrics_are_shaped_not_left_as_separate_letters(self):
        import numpy as np
        for text in ('கொஞ்சம்', 'क्षेत्र'):
            with self.subTest(text=text):
                shaped, unshaped = self.render_lyric_frame(text), self.render_lyric_frame(text, shaping='simple')
                self.assertGreater(int((shaped > 128).sum()), 500)
                self.assertGreater(int((np.abs(shaped.astype(int) - unshaped.astype(int)) > 80).sum()), 100)
        self.assertIn('shaping=complex', video_filters(VideoEditRequest(lyrics=[{'start': 0, 'end': 1, 'text': 'x'}])))

    def test_lyric_font_follows_the_script_and_matches_preview_size(self):
        from PIL import ImageFont
        import numpy as np
        self.assertEqual(lyric_font_for('தமிழ் song')[0], 'Noto Sans Tamil')
        self.assertEqual(lyric_font_for('Morning light')[0], 'Noto Sans')
        columns = np.where((self.render_lyric_frame('Morning light') > 128).any(axis=0))[0]
        # 44px at the 720 reference width, on a 1280 wide canvas, as the browser would lay it out.
        font = ImageFont.truetype(str(LYRIC_FONTS_DIR / 'NotoSans-Bold.ttf'), round(44 * 1280 / 720))
        self.assertAlmostEqual(columns[-1] - columns[0], font.getlength('Morning light'), delta=font.getlength('Morning light') * 0.04)

    def test_location_is_removed_unless_requested(self):
        source = self.root / 'gps.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(self.source), '-c', 'copy', '-metadata', 'location=+13.0148+080.1903/', '-metadata', 'creation_time=2024-07-08T10:00:00Z', '-movflags', 'use_metadata_tags', '-y', str(source)], check=True, capture_output=True, timeout=20)
        self.assertIn('location', _run_ffprobe(source)['format']['tags'])
        for keep, name in ((False, 'clean.mp4'), (True, 'kept.mp4')):
            edit = VideoEditRequest(trim_end=0.5, keep_location=keep)
            render_video_copy(source, self.root / name, edit, inspect_editable_video(source, edit), lambda _: None)
            tags = _run_ffprobe(self.root / name)['format']['tags']
            self.assertEqual('location' in tags, keep)
            self.assertIn('2024-07-08', tags['creation_time'])

    def test_hdr_video_is_tone_mapped_and_tagged_as_sdr(self):
        source = self.root / 'hlg.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=1', '-c:v', 'libx265', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p10le',
                        '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-tag:v', 'hvc1', '-y', str(source)], check=True, capture_output=True, timeout=30)
        for name, update in (('plain', {}), ('bright', {'brightness': 1.2})):
            edit = VideoEditRequest(trim_end=0.5, **update)
            output = self.root / f'{name}.mp4'
            render_video_copy(source, output, edit, inspect_editable_video(source, edit), lambda _: None)
            video = next(s for s in _run_ffprobe(output)['streams'] if s['codec_type'] == 'video')
            self.assertEqual((video['pix_fmt'], video['color_transfer'], video['color_primaries'], video['color_space']), ('yuv420p', 'bt709', 'bt709', 'bt709'))

    def test_photo_background_colors_survive_export(self):
        import numpy as np
        from PIL import Image
        asset_id = 'b' * 32
        audio = self.root / 'video_audio' / asset_id
        audio.parent.mkdir(exist_ok=True)
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-f', 'wav', str(audio)], check=True, capture_output=True, timeout=10)
        image = self.root / 'red.png'
        Image.new('RGB', (640, 360), (200, 40, 40)).save(image)
        for animation in ('none', 'zoom-in'):
            edit = VideoEditRequest(audio_asset_id=asset_id, trim_end=1, canvas='landscape', image_animation=animation)
            output = self.root / f'red-{animation}.mp4'
            with patch.object(settings, 'data_dir', self.root):
                render_video_copy(image, output, edit, inspect_editable_video(image, edit, background_is_image=True), lambda _: None, background_is_image=True)
            data = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(output), '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], check=True, capture_output=True, timeout=10)
            mean = np.frombuffer(data.stdout, dtype=np.uint8).reshape(720, 1280, 3).mean(axis=(0, 1))
            self.assertLess(np.abs(mean - (200, 40, 40)).max(), 6)

    def test_slideshow_pan_moves_the_picture_left_like_the_preview(self):
        import numpy as np
        from PIL import Image
        asset_id = 'c' * 32
        audio = self.root / 'video_audio' / asset_id
        audio.parent.mkdir(exist_ok=True)
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-f', 'wav', str(audio)], check=True, capture_output=True, timeout=10)
        image = self.root / 'marker.png'
        picture = np.zeros((720, 1280, 3), dtype=np.uint8)
        picture[:, 620:660] = 255
        Image.fromarray(picture).save(image)
        edit = VideoEditRequest(audio_asset_id=asset_id, trim_end=2, canvas='landscape', image_animation='pan-left')
        output = self.root / 'pan.mp4'
        with patch.object(settings, 'data_dir', self.root):
            render_video_copy(image, output, edit, inspect_editable_video(image, edit, background_is_image=True), lambda _: None, background_is_image=True)
        def marker_x(at):
            data = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-ss', str(at), '-i', str(output), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], check=True, capture_output=True, timeout=10)
            return np.where(np.frombuffer(data.stdout, dtype=np.uint8).reshape(720, 1280).mean(axis=0) > 128)[0].mean()
        self.assertGreater(marker_x(0.1), marker_x(1.8) + 40)

    def test_timed_crossfaded_ken_burns_slideshow_at_1080p(self):
        import numpy as np
        from PIL import Image
        asset_id = 'd' * 32
        audio = self.root / 'video_audio' / asset_id
        audio.parent.mkdir(exist_ok=True)
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '6', '-f', 'wav', str(audio)], check=True, capture_output=True, timeout=10)
        images = []
        for index, color in enumerate(((220, 30, 30), (30, 220, 30), (30, 30, 220))):
            path = self.root / f'image-{index}.png'
            Image.new('RGB', (640, 360), color).save(path)
            images.append((path, {}))
        edit = VideoEditRequest(audio_asset_id=asset_id, trim_end=6, canvas='square', quality='1080p', image_animation='ken-burns', transition='crossfade',
                                slide_starts=[0, 1.5, 4], lyric_style='band', lyrics=[{'start': 0.2, 'end': 5, 'text': 'தமிழ் பாடல்'}])
        output = self.root / 'timed.mp4'
        with patch.object(settings, 'data_dir', self.root):
            render_video_copy(images[0][0], output, edit, inspect_editable_video(images[0][0], edit, background_is_image=True), lambda _: None, background_is_image=True, backgrounds=images)
        video = next(stream for stream in _run_ffprobe(output)['streams'] if stream['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height']), (1080, 1080))
        self.assertAlmostEqual(float(_run_ffprobe(output)['format']['duration']), 6, delta=0.15)

        def corner(at):
            data = subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-ss', str(at), '-i', str(output), '-frames:v', '1', '-vf', 'crop=200:200:0:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], check=True, capture_output=True, timeout=10)
            return np.frombuffer(data.stdout, dtype=np.uint8).reshape(200, 200, 3).mean(axis=(0, 1))
        self.assertEqual(int(np.argmax(corner(1))), 0)
        self.assertEqual(int(np.argmax(corner(3))), 1)
        self.assertEqual(int(np.argmax(corner(5.5))), 2)
        blending = corner(1.9)
        self.assertGreater(blending[0], 60)
        self.assertGreater(blending[1], 60)

    def test_4k_slideshow_is_true_4k(self):
        from PIL import Image
        asset_id = 'f' * 32
        audio = self.root / 'video_audio' / asset_id
        audio.parent.mkdir(exist_ok=True)
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-f', 'wav', str(audio)], check=True, capture_output=True, timeout=10)
        image = self.root / 'wide.png'
        Image.new('RGB', (640, 360), (40, 90, 200)).save(image)
        edit = VideoEditRequest(audio_asset_id=asset_id, trim_end=1, canvas='landscape', quality='4k', image_animation='ken-burns', lyrics=[{'start': 0.1, 'end': 0.9, 'text': 'தமிழ்'}])
        output = self.root / 'uhd.mp4'
        with patch.object(settings, 'data_dir', self.root):
            render_video_copy(image, output, edit, inspect_editable_video(image, edit, background_is_image=True), lambda _: None, background_is_image=True)
        video = next(stream for stream in _run_ffprobe(output)['streams'] if stream['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height']), (3840, 2160))

    def test_out_of_order_slide_times_are_refused(self):
        from PIL import Image
        image = self.root / 'a.png'
        Image.new('RGB', (64, 64)).save(image)
        asset_id = 'e' * 32
        audio = self.root / 'video_audio' / asset_id
        audio.parent.mkdir(exist_ok=True)
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-f', 'wav', str(audio)], check=True, capture_output=True, timeout=10)
        with patch.object(settings, 'data_dir', self.root), self.assertRaisesRegex(ValueError, 'Image start times'):
            inspect_editable_video(image, VideoEditRequest(audio_asset_id=asset_id, slide_starts=[0, 1, 0.5]), background_is_image=True)

    def test_lyric_animation_tags_and_literal_text(self):
        from app.services.video_edit_service import write_lyrics
        for animation, tag in [('fade', r'\fad('), ('slide-up', r'\move(')]:
            edit = VideoEditRequest(canvas='portrait', lyric_animation=animation, lyrics=[{'start': 0, 'end': 1, 'text': r'{\evil} Hello'}])
            path = self.root / 'captions.ass'
            write_lyrics(path, edit, self.source)
            text = path.read_text()
            self.assertIn(tag, text)
            self.assertNotIn(r'{\evil}', text)

    def test_invalid_ranges_and_values(self):
        for edit in [VideoEditRequest(trim_start=3), VideoEditRequest(trim_end=4), VideoEditRequest(trim_start=1, trim_end=1.05)]:
            with self.assertRaises(ValueError):
                inspect_editable_video(self.source, edit)
        for changes in [{'trim_start': float('nan')}, {'trim_end': float('inf')}, {'rotation': 45}, {'brightness': 8}, {'volume': -1}, {'unknown_filter': 'bad'}]:
            with self.assertRaises(ValidationError):
                VideoEditRequest(**changes)
        with patch('app.services.video_edit_service.shutil.which', return_value=None):
            with self.assertRaisesRegex(ValueError, 'ffmpeg'):
                inspect_editable_video(self.source, VideoEditRequest())

    def test_failure_leaves_no_partial_and_does_not_overwrite(self):
        target = self.root / 'exists.mp4'
        target.write_bytes(b'existing file')
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            render_video_copy(self.source, target, VideoEditRequest(trim_end=0.5), 0.5, lambda _: None)
        self.assertEqual(target.read_bytes(), b'existing file')
        missing = self.root / 'missing.mp4'
        with self.assertRaisesRegex(RuntimeError, 'Video export failed'):
            render_video_copy(missing, self.root / 'bad.mp4', VideoEditRequest(), 1, lambda _: None)
        self.assertFalse((self.root / 'bad.mp4').exists())
        self.assertFalse(list(self.root.glob('.video-export-*')))


if __name__ == '__main__':
    unittest.main()
