"""GPU render engine: what it accepts, its plan, and a real render compared frame by frame with the ffmpeg export."""
import os
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from app.services import gpu_render
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Timeline
from app.services.timeline_service import render_timeline

FPS = 30


def timeline(seconds=30, width=1920, height=1080, **extra_clip):
    main = []
    for k in range(int(seconds // 6)):
        length = 6.0
        moves = {'x': [{'t': 0, 'v': 0.47, 'ease': 'easeInOut'}, {'t': length, 'v': 0.53, 'ease': 'easeInOut'}],
                 'scale': [{'t': 0, 'v': 1.05}, {'t': length, 'v': 1.18}]}
        joins = {} if not k else {'transition_in': {'kind': ('cross-blur', 'crossfade', 'dip', 'flash')[(k - 1) % 4], 'duration': 0.8}}
        main.append({'id': f'm{k}', 'media_id': 1 + k % 3, 'start': k * length, 'in': 0, 'out': length, 'transform': {'scale': 1.05, 'keyframes': moves}, **joins, **extra_clip})
    pip = [{'id': 'pip', 'media_id': 4, 'start': 2, 'in': 0.5, 'out': 0.5 + seconds - 6, 'transform': {'x': 0.75, 'y': 0.3, 'scale': 0.35,
            'keyframes': {'opacity': [{'t': 0, 'v': 1}, {'t': seconds / 2, 'v': 0.6}]}}, 'enter': {'preset': 'fade', 'duration': 0.8}, 'exit': {'preset': 'fade', 'duration': 1}}]
    logo = [{'id': 'logo', 'media_id': 5, 'start': 0, 'in': 0, 'out': seconds, 'transform': {'x': 0.9, 'y': 0.88, 'scale': 0.12, 'opacity': 0.8}}]
    return Timeline.model_validate({'format': {'width': width, 'height': height, 'fps': FPS}, 'layers': [
        {'id': 'main', 'kind': 'video', 'items': main}, {'id': 'pip-layer', 'kind': 'video', 'items': pip}, {'id': 'logo-layer', 'kind': 'video', 'items': logo},
        {'id': 'words', 'kind': 'text', 'items': titles(seconds)[:-1]}, {'id': 'brand', 'kind': 'text', 'items': titles(seconds)[-1:]}]})


def titles(seconds):
    """Tamil karaoke lines with fades, and an English outline title that drifts."""
    lines = [{'id': f'line{n}', 'start': 1 + n * 5, 'length': 4.5, 'text': 'கற்கண்டு போல இனிக்கும் பாடல்', 'style': 'shadow', 'size': 48,
              'enter': {'preset': 'fade', 'duration': 0.5}, 'exit': {'preset': 'fade', 'duration': 0.5}, 'karaoke': {'color': '#ffd54a', 'words': [0.3, 1.2, 2.1, 3.0]}}
             for n in range(int(seconds // 5) - 1)]
    return lines + [{'id': 'name', 'start': 0.5, 'length': min(8, seconds - 1), 'text': 'KavinTamil Originals', 'style': 'outline', 'position': 'top', 'size': 40,
                     'transform': {'keyframes': {'y': [{'t': 0, 'v': 0.5}, {'t': 6, 'v': 0.55, 'ease': 'easeOut'}]}}, 'enter': {'preset': 'fade', 'duration': 1}}]


class Accepts(unittest.TestCase):
    facts = staticmethod(lambda _: MediaFacts(path=Path('x.png'), media_type='image', width=640, height=360))

    def test_moves_size_opacity_and_fades_are_drawn(self):
        self.assertEqual(gpu_render.unsupported(timeline(), self.facts), [])

    def test_anything_else_is_named_so_ffmpeg_keeps_it(self):
        missing = gpu_render.unsupported(timeline(look='warm', transition_in={'kind': 'zoom', 'duration': 0.6}), self.facts)
        self.assertEqual(missing, ['looks', 'zoom transition'])

    def test_a_transition_is_centred_on_the_cut(self):
        with mock.patch('app.services.timeline_service.render_text_image'):
            work = gpu_render.plan(timeline(), self.facts, Path('out.mp4'), 1, Path('/tmp'))
        before, after = work['items'][0], work['items'][1]
        self.assertEqual((before['start'], before['frames']), (0, 6 * FPS + 12))  # Plays on 12 frames into the cross blur.
        self.assertEqual((after['start'], after['frames']), (6 * FPS - 12, 6 * FPS + 24))  # Starts 12 early; the next join too.
        mix = after['transition']
        self.assertEqual(mix['frames'], 24)
        self.assertEqual(mix['weights'][0], [1, 0, 0])
        self.assertGreater(mix['blur'][12], mix['blur'][1])  # Blur peaks halfway.
        dip = work['items'][3]['transition']['weights'][12]
        self.assertEqual(dip[0], 0)  # Halfway through a dip the clip before is gone, mostly black, the next one showing.
        self.assertGreater(dip[2], dip[1])
        self.assertAlmostEqual(sum(dip), 1, places=5)

    def test_titles_that_need_more_stay_with_ffmpeg(self):
        data = timeline().model_dump(by_alias=True, mode='json')
        data['layers'][3]['items'][0]['enter'] = {'preset': 'pop', 'duration': 0.5}
        self.assertEqual(gpu_render.unsupported(Timeline.model_validate(data), self.facts), ['pop animation'])

    def test_plan_matches_the_schema_maths(self):
        with mock.patch('app.services.timeline_service.render_text_image'):
            work = gpu_render.plan(timeline(), self.facts, Path('out.mp4'), 1, Path('/tmp'))
        self.assertEqual(work['frames'], 30 * FPS)
        pip = work['items'][5]
        self.assertEqual(pip['start'], 2 * FPS)
        self.assertEqual(pip['opacity'][0], 0)  # Fading in.
        self.assertAlmostEqual(pip['opacity'][24], 0.979, places=2)  # Faded in; the opacity keys are easing it down.
        self.assertEqual(pip['opacity'][-1] < 0.05, True)  # Faded out.
        line = work['items'][7]
        self.assertEqual(len(line['paths']), 5)  # Nothing sung, then four words.
        self.assertEqual([line['shown'][k] for k in (0, 8, 9, 36, 89, 134)], [0, 0, 1, 2, 3, 4])


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('swiftc'), 'needs ffmpeg and Swift')
class MatchesFfmpeg(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp())
        cls.facts = {}
        for n, source in enumerate(['testsrc2=s=1920x1080', 'smptehdbars=s=1920x1080', 'mandelbrot=s=1280x720'], start=1):
            path = cls.root / f'p{n}.png'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', source, '-frames:v', '1', str(path)], check=True)
            cls.facts[n] = MediaFacts(path=path, media_type='image', width=1920 if n < 3 else 1280, height=1080 if n < 3 else 720)
        video = cls.root / 'v.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=1280x720:r=30:d=40', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', str(video)], check=True)
        cls.facts[4] = MediaFacts(path=video, media_type='video', width=1280, height=720, duration=40, fps=30)
        logo = cls.root / 'logo.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=400x400', '-frames:v', '1', str(logo)], check=True)
        cls.facts[5] = MediaFacts(path=logo, media_type='image', width=400, height=400)
        from app.services.cutout_service import helper
        with mock.patch('app.services.cutout_service.settings') as settings:
            settings.data_dir = cls.root
            cls.tool = helper(gpu_render.SOURCE)

    @classmethod
    def tearDownClass(cls):
        if not os.environ.get('GPU_KEEP'):
            shutil.rmtree(cls.root, ignore_errors=True)
        else:
            print('kept', cls.root)

    def test_same_picture_and_faster(self):
        work = timeline(int(os.environ.get('GPU_BENCH_SECONDS', '30')))
        ffmpeg_out, gpu_out = self.root / 'ffmpeg.mp4', self.root / 'gpu.mp4'
        began = time.monotonic()
        with mock.patch.dict(os.environ, {'KANAA_PARALLEL_EXPORT': '0'}):
            render_timeline(work, self.facts.__getitem__, lambda _: None, ffmpeg_out, lambda _: None)
        ffmpeg_seconds = time.monotonic() - began
        began = time.monotonic()
        gpu_render.render(work, self.facts.__getitem__, gpu_out, tool=self.tool)
        gpu_seconds = time.monotonic() - began
        frames = lambda path: int(subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames',
                                                  '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout.strip())
        self.assertEqual(frames(gpu_out), frames(ffmpeg_out))
        log = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(ffmpeg_out), '-i', str(gpu_out), '-lavfi', 'psnr=stats_file=-', '-f', 'null', '-'],
                             capture_output=True, text=True).stdout
        values = [float(v) for v in re.findall(r'psnr_avg:([0-9.]+)', log)]
        print(f'\nffmpeg {ffmpeg_seconds:.1f}s, GPU {gpu_seconds:.1f}s ({ffmpeg_seconds / gpu_seconds:.1f}x); PSNR worst {min(values):.1f} dB, average {sum(values) / len(values):.1f} dB')
        self.assertGreater(sum(values) / len(values), 35)
        # Only the frame where a karaoke line's first word lights may differ: the ffmpeg export lights it a frame late
        # (its concat timing), the GPU engine on the word's own frame, as the preview does.
        self.assertLessEqual(sum(value < 30 for value in values), len(titles(30)) - 1)
        self.assertLess(gpu_seconds, ffmpeg_seconds)


if __name__ == '__main__':
    unittest.main()
