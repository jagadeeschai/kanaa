import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from types import SimpleNamespace

from app.services import gpu_export
from app.services.job_service import JobCancelled
from tests.test_gpu_render import timeline, Accepts


class GpuFallback(unittest.TestCase):
    def run_export(self, cancel=lambda: False):
        return gpu_export.try_render(timeline(), Accepts.facts, lambda _: None, Path(self.folder) / 'out.mp4',
                                     lambda _: None, cancel, None, None, None, True, 'ffmpeg')

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.folder = self.directory.name
        switched_on = mock.patch.dict(os.environ, {'KANAA_GPU_RENDER': '1'})
        switched_on.start()
        self.addCleanup(switched_on.stop)

    def test_off_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch('app.services.gpu_render.render') as render:
            os.environ.pop('KANAA_GPU_RENDER', None)
            self.assertFalse(self.run_export())
            render.assert_not_called()

    def test_disabled_does_not_compile_or_render(self):
        with mock.patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}), mock.patch('app.services.gpu_render.render') as render:
            self.assertFalse(self.run_export())
            render.assert_not_called()

    def test_failure_falls_back_and_does_not_publish(self):
        with mock.patch('app.services.timeline_service._hardware_h264', return_value=True), \
             mock.patch('app.services.gpu_audio.compile_audio', side_effect=RuntimeError('test failure')):
            with self.assertLogs('app.services.gpu_export', level='ERROR'):
                self.assertFalse(self.run_export())
        self.assertFalse((Path(self.folder) / 'out.mp4').exists())

    def test_cancellation_never_falls_back(self):
        with mock.patch('app.services.timeline_service._hardware_h264', return_value=True):
            with self.assertRaises(JobCancelled):
                self.run_export(lambda: True)

    def test_audio_graph_is_identical_without_drawing_titles(self):
        from app.services.gpu_audio import compile_audio
        from app.services.timeline_service import compile_timeline
        from app.services.media_probe import MediaFacts
        facts = lambda _: MediaFacts(path=Path('/tmp/source.mp4'), media_type='video', width=640, height=360, duration=40, has_audio=True)
        with mock.patch('app.services.timeline_service.render_text_image'):
            reference = compile_timeline(timeline(), facts, lambda _: None, Path(self.folder))
        with mock.patch('app.services.timeline_service.render_text_image') as draw:
            audio = compile_audio(timeline(), facts, lambda _: None, Path(self.folder))
            draw.assert_not_called()
        self.assertEqual(audio.audio_args, reference.audio_args)
        self.assertEqual(audio.audio_graph, reference.audio_graph)
        self.assertEqual(audio.duration, reference.duration)

    def test_success_mixes_once_muxes_and_publishes_complete_file(self):
        for normalize in (False, True):
            with self.subTest(normalize=normalize):
                target = Path(self.folder) / f'ready-{normalize}.mp4'
                compiled = SimpleNamespace(has_audio=True, normalize_audio=normalize)
                progress = []
                def render(_timeline, _media, output, report, **kwargs):
                    output.write_bytes(b'silent')
                    report(50)
                def mux(arguments, cancel):
                    self.assertIn('copy', arguments)
                    self.assertIn('192k', arguments)
                    Path(arguments[-1]).write_bytes(b'complete')
                    return SimpleNamespace(returncode=0)
                with mock.patch('app.services.timeline_service._hardware_h264', return_value=True), \
                     mock.patch('app.services.gpu_audio.compile_audio', return_value=compiled), \
                     mock.patch('app.services.timeline_service.mix_audio', return_value=Path('mix.wav')) as mix, \
                     mock.patch('app.services.timeline_service.normalize_loudness', return_value=Path('normal.wav')) as normal, \
                     mock.patch('app.services.gpu_render.render', side_effect=render), \
                     mock.patch('app.services.timeline_service.run_cancellable', side_effect=mux):
                    self.assertTrue(gpu_export.try_render(timeline(), Accepts.facts, lambda _: None, target, progress.append,
                                                         lambda: False, None, None, None, True, 'ffmpeg'))
                    mix.assert_called_once()
                    self.assertEqual(normal.call_count, int(normalize))
                self.assertEqual(target.read_bytes(), b'complete')
                self.assertEqual((progress[0], progress[-1]), (3, 99))
