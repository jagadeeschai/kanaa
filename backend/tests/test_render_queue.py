import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.api.schemas import VideoEditRequest
from app.core.config import settings
from app.db import database
from app.main import app
from app.services import render_queue_service as render_queue
from app.services.job_service import JobCancelled, get_job
from app.services.video_edit_service import check_disk_space, inspect_editable_video, render_video_copy
from app.services.video_service import parse_byte_range, UNSATISFIABLE_RANGE


def wait_until_done(job_id):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        job = get_job(job_id)
        if job and job['done']:
            return job
        time.sleep(0.02)
    raise AssertionError('job did not finish')


class RenderQueueTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.patches = [patch.object(settings, 'data_dir', self.root),
                        patch.object(settings, 'edit_workspace_dir', self.root / 'workspace')]
        for item in self.patches:
            item.start()
        database.init_db()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.folder.cleanup()

    def test_jobs_run_one_at_a_time_in_order(self):
        order, running, overlapped = [], [0], [False]

        def job(name):
            def run(_):
                running[0] += 1
                overlapped[0] = overlapped[0] or running[0] > 1
                time.sleep(0.05)
                order.append(name)
                running[0] -= 1
                return {}
            return run

        ids = [render_queue.enqueue_render('test', name, job(name)) for name in 'abc']
        for job_id in ids:
            self.assertEqual(wait_until_done(job_id)['status'], 'done')
        self.assertEqual(order, ['a', 'b', 'c'])
        self.assertFalse(overlapped[0])

    def test_waiting_job_can_be_cancelled_and_never_runs(self):
        release, ran = threading.Event(), []
        first = render_queue.enqueue_render('test', 'first', lambda _: release.wait(5) and {})
        second = render_queue.enqueue_render('test', 'second', lambda _: ran.append(1) or {})
        self.assertTrue(render_queue.cancel_render(second))
        release.set()
        wait_until_done(first)
        self.assertEqual(get_job(second)['status'], 'cancelled')
        self.assertFalse(ran)
        self.assertFalse(render_queue.cancel_render(second))

    def test_failure_is_recorded_and_survives_losing_memory(self):
        def boom(_):
            raise RuntimeError('Encoder exploded')
        job_id = render_queue.enqueue_render('test', 'bad', boom)
        wait_until_done(job_id)
        with patch.object(render_queue, 'get_job', return_value=None):
            stored = render_queue.get_stored_render_job(job_id)
        self.assertEqual((stored['status'], stored['error'], stored['done']), ('failed', 'Encoder exploded', True))

    def test_restart_closes_active_jobs_and_clears_leftovers(self):
        with database.get_connection() as conn:
            conn.execute("INSERT INTO render_jobs (id, kind, label, status) VALUES ('old', 'video_export', 'x', 'running')")
            conn.commit()
        leftover = self.root / 'workspace' / '.video-export-abc'
        leftover.mkdir(parents=True)
        kept = self.root / 'workspace' / 'keep.mp4'
        kept.write_bytes(b'x')
        render_queue.recover_after_restart()
        stored = render_queue.get_stored_render_job('old')
        self.assertEqual(stored['status'], 'failed')
        self.assertIn('restarted', stored['error'])
        self.assertFalse(leftover.exists())
        self.assertTrue(kept.exists())

    def test_old_songs_are_removed_unless_a_project_uses_them(self):
        import os
        audio = self.root / 'video_audio'
        audio.mkdir()
        used, unused, recent = audio / ('a' * 32), audio / ('b' * 32), audio / ('c' * 32)
        for path in (used, unused, recent):
            path.write_bytes(b'x')
        old = time.time() - render_queue.AUDIO_RETENTION_SECONDS - 60
        os.utime(used, (old, old))
        os.utime(unused, (old, old))
        with database.get_connection() as conn:
            conn.execute("INSERT INTO photos (id, filename, absolute_path, media_type) VALUES (1, 'a.mp4', '/l/a.mp4', 'video')")
            conn.execute("INSERT INTO projects (name, media_id, kind, recipe) VALUES ('p', 1, 'lyric', ?)", (f'{{"song": {{"id": "{used.name}"}}}}',))
            conn.commit()
        render_queue.recover_after_restart()
        self.assertTrue(used.exists())
        self.assertFalse(unused.exists())
        self.assertTrue(recent.exists())

    def test_cancel_stops_a_running_export_and_leaves_nothing(self):
        source = self.root / 'source.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', str(source)], check=True, capture_output=True, timeout=60)
        edit = VideoEditRequest()
        duration = inspect_editable_video(source, edit)
        target = self.root / 'workspace' / 'out.mp4'
        cancel = threading.Event()
        threading.Timer(0.5, cancel.set).start()
        started = time.monotonic()
        with self.assertRaises(JobCancelled):
            render_video_copy(source, target, edit, duration, lambda _: None, should_cancel=cancel.is_set)
        self.assertLess(time.monotonic() - started, 8)
        self.assertFalse(target.exists())
        self.assertFalse(list(target.parent.glob('.video-export-*')))

    def test_low_disk_is_refused_before_export(self):
        with patch('app.services.video_edit_service.shutil.disk_usage', return_value=MagicMock(free=100_000_000)):
            with self.assertRaisesRegex(ValueError, 'Not enough disk space'):
                check_disk_space(self.root, 60)

    def test_byte_ranges(self):
        self.assertEqual(parse_byte_range('bytes=0-99', 1000), (0, 99))
        self.assertEqual(parse_byte_range('bytes=900-', 1000), (900, 999))
        self.assertEqual(parse_byte_range('bytes=-500', 1000), (500, 999))
        self.assertEqual(parse_byte_range('bytes=-5000', 1000), (0, 999))
        self.assertEqual(parse_byte_range('bytes=900-5000', 1000), (900, 999))
        self.assertEqual(parse_byte_range('bytes=1000-', 1000), UNSATISFIABLE_RANGE)
        self.assertEqual(parse_byte_range('bytes=50-10', 1000), UNSATISFIABLE_RANGE)
        self.assertIsNone(parse_byte_range('bytes=abc', 1000))
        self.assertIsNone(parse_byte_range('bytes=0-1,5-6', 1000))


if __name__ == '__main__':
    unittest.main()
