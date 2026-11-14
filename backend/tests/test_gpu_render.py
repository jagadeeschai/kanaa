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

    def test_colour_plan_combines_look_and_adjustments_before_pose(self):
        work = timeline(look='warm', adjust={'brightness': 1.1, 'temperature': 1.2, 'tint': .9, 'gamma': 2, 'fade': .1})
        with mock.patch('app.services.timeline_service.render_text_image'):
            item = gpu_render.plan(work, self.facts, Path('out.mp4'), 1, Path('/tmp'))['items'][0]
        self.assertEqual(item['colour']['tint'], [1.4256, .99, .792])
        self.assertEqual(item['colour']['power'], .5)
        self.assertEqual(item['colour']['fade'], .1)
        self.assertEqual(gpu_render.unsupported(work, self.facts), [])

    def test_glow_softens_in_canvas_pixels_like_the_export(self):
        """The export softens after fitting the picture into its canvas, so a small source needs a smaller radius in its
        own pixels, and a large one a bigger radius."""
        glowing = timeline(dreamy_glow={'intensity': 0.45, 'softness': 0.5, 'warmth': 0.2})
        radius = lambda width, height: gpu_render.plan(glowing, lambda _: MediaFacts(path=Path('x.png'), media_type='image', width=width, height=height),
                                                      Path('out.mp4'), 1, Path('/tmp'))['items'][0]['glow']['radius']
        with mock.patch('app.services.timeline_service.render_text_image'):
            canvas = radius(1920, 1080)  # Fills the canvas at a scale of 1 (the clip zooms to 1.18 within a 1080p source).
            small, large = radius(768, 432), radius(3840, 2160)
        self.assertLess(small, canvas)
        self.assertGreater(large, canvas)

    def test_turns_remain_unsupported(self):
        self.assertIn('turn adjustments', gpu_render.unsupported(timeline(adjust={'flip_horizontal': True}), self.facts))

    def test_zero_second_freeze_and_hdr_keep_reference_path(self):
        self.assertIn('freeze', gpu_render.unsupported(timeline(freeze=0), self.facts))
        hdr = lambda _: MediaFacts(path=Path('hdr.mp4'), media_type='video', width=640, height=360, color_transfer='smpte2084')
        self.assertIn('HDR tone mapping', gpu_render.unsupported(timeline(), hdr))

    def test_mask_blend_rotation_pulse_and_zoom_blur_reach_the_plan(self):
        from app.services.timeline_schema import BeatPulse, ZoomBlur
        work = timeline()
        clip = work.layers[1].items[0]
        clip.cutout = 'remove'
        clip.transform.rotation = 12
        clip.beat_pulse = BeatPulse()
        clip.zoom_blur = ZoomBlur(intensity=.3)
        work.layers[1].blend = 'screen'
        mask = mock.Mock(return_value=Path('mask.mp4'))
        with mock.patch('app.services.timeline_service.render_text_image'):
            item = gpu_render.plan(work, self.facts, Path('out.mp4'), 1, Path('/tmp'), masks=mask)['items'][5]
        self.assertEqual(item['mask_path'], 'mask.mp4')
        mask.assert_called_once()
        self.assertEqual(item['blend'], 'screen')
        self.assertEqual(item['rotation'][0], 12)
        self.assertEqual(len(item['zoom_blur']['scales']), 8)
        self.assertAlmostEqual(item['scale'][0], .35 * 1.024)
        self.assertEqual(gpu_render.unsupported(work, self.facts), [])

    def test_cancellation_terminates_a_blocked_helper(self):
        from app.services.job_service import JobCancelled
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            helper = root / 'helper'
            helper.write_text('#!/bin/sh\nexec sleep 10\n')
            helper.chmod(0o755)
            began = time.monotonic()
            with mock.patch.object(gpu_render, 'unsupported', return_value=[]), mock.patch.object(gpu_render, 'plan', return_value={'frames': 300}):
                with self.assertRaises(JobCancelled):
                    gpu_render.render(timeline(), self.facts, root / 'out.mp4', tool=helper, should_cancel=lambda: time.monotonic() - began > .05)
            self.assertLess(time.monotonic() - began, 3)

    def test_glow_constants_and_disabled_glow(self):
        from app.services.timeline_schema import DreamyGlow
        self.assertIsNone(gpu_render.glow_constants(DreamyGlow(intensity=0)))
        constants = gpu_render.glow_constants(DreamyGlow(intensity=.5, softness=.5, warmth=.5))
        self.assertAlmostEqual(constants['amount'], .7)
        self.assertEqual(constants['red'], .0112)
        self.assertEqual(constants['blue'], -.0063)

    def test_slide_moves_the_full_posed_frame(self):
        from app.services.timeline_schema import Animation, Transform
        sampled = gpu_render._frames(Transform(), Animation(preset='slide-right', duration=1), None, 2, 60, 30)
        self.assertEqual(sampled['dx'][0], -1)
        self.assertEqual(sampled['dx'][30], 0)
        self.assertEqual(sampled['x'][0], .5)
        self.assertEqual(sampled['opacity'][0], 1)

    def test_anything_else_is_named_so_ffmpeg_keeps_it(self):
        missing = gpu_render.unsupported(timeline(look='warm', transition_in={'kind': 'zoom', 'duration': 0.6}), self.facts)
        self.assertEqual(missing, ['zoom transition'])

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
        data['layers'][3]['items'][0]['enter'] = {'preset': 'prism', 'duration': 0.5}
        self.assertIn('prism animation', gpu_render.unsupported(Timeline.model_validate(data), self.facts))

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
        cls.mask = cls.root / 'mask.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=1280x720:r=30:d=40,drawbox=x=300:y=100:w=500:h=500:color=white:t=fill',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(cls.mask)], check=True)
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
        work = timeline(int(os.environ.get('GPU_BENCH_SECONDS', '30')), look='warm', dreamy_glow={'intensity': .5, 'softness': .5, 'warmth': .5},
                        adjust={'brightness': 1.03, 'gamma': 1.1, 'fade': 0.03, 'contrast': 1.04, 'saturation': 1.08, 'temperature': 1.02, 'tint': 0.98})
        presets = os.environ.get('GPU_ANIMATION_PRESETS', 'slide-right,pop,blur,blast,particle-form').split(',')
        for item, preset in zip(work.layers[3].items, presets):
            from app.services.timeline_schema import Animation
            item.enter = Animation(preset=preset, duration=.6)
        if os.environ.get('GPU_EXTRA_EFFECTS') == '1':
            from app.services.timeline_schema import BeatPulse, ZoomBlur
            clip = work.layers[1].items[0]
            clip.cutout = 'remove'
            clip.transform.rotation = 12
            clip.beat_pulse = BeatPulse()
            clip.zoom_blur = ZoomBlur(intensity=.3)
            work.layers[2].blend = 'screen'
        ffmpeg_out, gpu_out = self.root / 'ffmpeg.mp4', self.root / 'gpu.mp4'
        began = time.monotonic()
        with mock.patch.dict(os.environ, {'KANAA_PARALLEL_EXPORT': '0', 'KANAA_GPU_RENDER': '0'}):
            render_timeline(work, self.facts.__getitem__, lambda _: None, ffmpeg_out, lambda _: None, masks=lambda *_: self.mask)
        ffmpeg_seconds = time.monotonic() - began
        began = time.monotonic()
        gpu_render.render(work, self.facts.__getitem__, gpu_out, tool=self.tool, masks=lambda *_: self.mask)
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
        from app.services.particle_frames import has_particles
        words = work.layers[3].items
        karaoke_frames = {round((item.start + item.karaoke.words[0]) * FPS) + 1 for item in words
                          if item.karaoke and item.karaoke.words and not has_particles(item)}
        unexpected = []
        for number, value in enumerate(values, start=1):
            if value >= 30 or number in karaoke_frames:
                continue
            # The handoff permits Core Image/bicubic edge differences. During a moving/scaled title's entrance,
            # those thin glyph edges can lower full-frame PSNR by up to two further dB; never exempt severe errors.
            t = (number - 1) / FPS
            moving_edges = value >= 28 and any(item.enter and item.enter.preset != 'fade' and
                item.start <= t <= item.start + item.enter.duration for item in words)
            if not moving_edges:
                unexpected.append((number, round(t, 3), value))
        self.assertEqual(unexpected, [], f'Unexpected low-PSNR frames: {unexpected[:20]}')
        self.assertLess(gpu_seconds, ffmpeg_seconds)


if __name__ == '__main__':
    unittest.main()
