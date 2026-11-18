"""Speed ramps on the GPU engine: each frame shows the source moment the ramp reaches, as the ffmpeg export does."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from app.services import gpu_render
from app.services.media_probe import MediaFacts
from app.services.ramp import ramp_share
from app.services.timeline_schema import Timeline
from app.services.timeline_service import render_timeline

W, H, FPS = 426, 240, 30
RAMPS = {'hero': [{'t': 0, 'v': 1}, {'t': 0.35, 'v': 1}, {'t': 0.45, 'v': 0.25}, {'t': 0.65, 'v': 0.25}, {'t': 0.75, 'v': 1}, {'t': 1, 'v': 1}],
         'speed-up': [{'t': 0, 'v': 0.4}, {'t': 1, 'v': 2}]}


def timeline(ramp, transition=False) -> Timeline:
    clips = [{'id': 'a', 'media_id': 1, 'start': 0, 'in': 0.5, 'out': 4.5, 'ramp': ramp}]
    if transition:
        clips = [{'id': 'z', 'media_id': 1, 'start': 0, 'in': 4.6, 'out': 5.6}, {**clips[0], 'start': 1, 'transition_in': {'kind': 'dip', 'duration': 0.6}}]
    return Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': FPS}, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': clips}]})


class RampSupport(unittest.TestCase):
    def test_a_ramp_stays_on_the_gpu(self):
        facts = {1: MediaFacts(path=Path('v.mp4'), media_type='video', width=W, height=H, duration=6, fps=FPS)}
        self.assertEqual(gpu_render.unsupported(timeline(RAMPS['hero']), facts.__getitem__), [])

    def test_the_plan_reads_the_source_where_the_ramp_is(self):
        from app.services.timeline_schema import RampPoint
        facts = {1: MediaFacts(path=Path('v.mp4'), media_type='video', width=W, height=H, duration=6, fps=FPS)}
        with tempfile.TemporaryDirectory() as folder:
            plan = gpu_render.plan(timeline(RAMPS['speed-up']), facts.__getitem__, Path(folder) / 'o.mp4', 1000, Path(folder))
        times = plan['items'][0]['times']
        self.assertEqual(len(times), 120)
        ramp = [RampPoint(**point) for point in RAMPS['speed-up']]
        # Each frame asks for the source half a frame on, as the export rounds to the nearest source frame.
        self.assertAlmostEqual(times[0], 0.5 + ramp_share(ramp, 0.5 / FPS / 4) * 4, places=5)
        steps = np.diff(times)
        self.assertTrue((steps > 0).all(), 'always forward')
        self.assertGreater(steps[-1], steps[0] * 3, 'slow at first, fast at the end')
        self.assertAlmostEqual(times[60], 0.5 + ramp_share(ramp, 60.5 / FPS / 4) * 4, places=5)


@unittest.skipUnless(shutil.which('ffmpeg') and sys.platform == 'darwin' and shutil.which('swiftc'), 'needs ffmpeg and Metal')
class RampOnTheGpu(unittest.TestCase):
    """Each source frame shows its own number as eight black and white bars, so both exports can be read frame by frame."""

    def test_the_gpu_shows_the_same_source_frames_as_the_export(self):
        from app.services.cutout_service import helper
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, bar = root / 'numbered.mp4', W // 8
            frames = np.zeros((180, H, W, 3), np.uint8)
            for n in range(180):
                for bit in range(8):
                    if n >> bit & 1:
                        frames[n, :, bit * bar:(bit + 1) * bar] = 255
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-crf', '10',
                            '-pix_fmt', 'yuv420p', '-g', '15', str(source)], input=frames.tobytes(), check=True)
            facts = {1: MediaFacts(path=source, media_type='video', width=W, height=H, duration=6, fps=FPS)}
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir = root
                tool = helper(gpu_render.SOURCE)

            def shown(path):
                rows = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True, check=True).stdout,
                                     np.uint8).reshape(-1, H, W)[:, H // 2, :]
                return np.array([sum(1 << bit for bit in range(8) if row[bit * bar + bar // 2] > 128) for row in rows])

            for name, ramp, transition in (('hero', RAMPS['hero'], False), ('speed-up', RAMPS['speed-up'], False), ('after a transition', RAMPS['hero'], True)):
                with self.subTest(name):
                    clips = timeline(ramp, transition)
                    cpu, gpu = root / f'{name}-cpu.mp4', root / f'{name}-gpu.mp4'
                    with patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
                        render_timeline(clips, facts.__getitem__, lambda a: a, cpu, lambda _: None, hardware=False)
                    gpu_render.render(clips, facts.__getitem__, gpu, tool=tool)
                    a, b = shown(cpu), shown(gpu)
                    self.assertEqual(len(a), len(b))
                    off = np.abs(a - b)
                    print(f'ramp {name}: {int((off == 0).sum())} of {len(a)} frames the same, at most {int(off.max())} apart')
                    if transition:
                        # The export seeks into the source for a transition's lead-in; the two can differ by a frame or two then.
                        self.assertLessEqual(int(off.max()), 2)
                    else:
                        self.assertEqual(int(off.max()), 0, 'frame for frame')


if __name__ == '__main__':
    unittest.main()
