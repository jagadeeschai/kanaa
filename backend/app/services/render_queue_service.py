"""Queues for heavy media jobs, in two lanes so an export never holds up preparation and preparation never holds up an
export. Each lane runs one job at a time (two 4K encodes at once would only slow both). Cancelling a running job frees
its lane at once: the job is marked cancelled and the lane goes on, while whatever step it was in (an FFmpeg pass that
does not check for cancel) finishes quietly and its result is dropped. Job records survive restarts; running work does not."""
from __future__ import annotations

import itertools
import logging
import queue
import shutil
import sqlite3
import threading
import time
from typing import Any, Callable

from app.core.config import settings
from app.db.database import get_connection
from app.services.job_service import JobCancelled, create_job, get_job, prune_finished_jobs, update_job

logger = logging.getLogger(__name__)

INTERRUPTED_MESSAGE = 'Interrupted because the server restarted. Please run it again.'
CANCELLED_MESSAGE = 'Cancelled'
ACTIVE_STATUSES = ('queued', 'running', 'cancelling')
RECENT_JOB_LIMIT = 20
KEPT_JOB_RECORDS = 100
AUDIO_RETENTION_SECONDS = 30 * 24 * 3600

# Work the user is waiting for runs before background preparation.
FOREGROUND_PRIORITY = 0
BACKGROUND_PRIORITY = 10

RenderTarget = Callable[[Callable[[], bool]], dict[str, Any]]

# Exports and renders to watch go in one lane; finding people, 3D pictures, preview copies, effects and the rest in the other.
EXPORT_KINDS = frozenset({'video_export', 'look', 'preview_render'})
LANES = ('export', 'work', 'build')
# A lyric video build waits on work jobs (finding people, effects, 3D), so it runs in a lane of its own.
BUILD_KINDS = {'lyric_build'}


def lane_of(kind: str) -> str:
    return 'export' if kind in EXPORT_KINDS else 'build' if kind in BUILD_KINDS else 'work'


_queues: dict[str, 'queue.PriorityQueue[tuple[int, int, str, RenderTarget]]'] = {lane: queue.PriorityQueue() for lane in LANES}
_order = itertools.count()
_cancel_events: dict[str, threading.Event] = {}
_workers: dict[str, threading.Thread | None] = {lane: None for lane in LANES}
_generation: dict[str, int] = {lane: 0 for lane in LANES}  # A cancelled job's worker is retired by bumping this.
_running: dict[str, str | None] = {lane: None for lane in LANES}
_lane_of_job: dict[str, str] = {}
_worker_lock = threading.Lock()


def _save(job_id: str, sql: str, values: tuple) -> None:
    try:
        with get_connection() as conn:
            conn.execute(sql, (*values, job_id))
            conn.commit()
    except sqlite3.Error:
        logger.exception('Could not record render job %s', job_id)


def enqueue_render(kind: str, label: str, target: RenderTarget, priority: int = FOREGROUND_PRIORITY,
                   reserve: Callable[[str], None] | None = None, **initial: Any) -> str:
    """target receives should_cancel() and returns the job's final fields. reserve gets the id before the job can start."""
    job_id = create_job(kind, status='queued', label=label, phase='Waiting in the queue', **initial)
    try:
        with get_connection() as conn:
            conn.execute('INSERT INTO render_jobs (id, kind, label, status) VALUES (?, ?, ?, ?)', (job_id, kind, label, 'queued'))
            conn.commit()
    except sqlite3.Error:
        logger.exception('Could not record render job %s', job_id)
    _cancel_events[job_id] = threading.Event()
    lane = lane_of(kind)
    _lane_of_job[job_id] = lane
    if reserve:
        reserve(job_id)
    _work_of[job_id] = (kind, priority, target)
    _queues[lane].put((priority, next(_order), job_id, target))
    _ensure_worker(lane)
    return job_id


# What each job does, kept while Kanaa runs so a job that failed can be tried again (under the same id, so its
# progress and result land where the person is looking). Finished jobs drop theirs; at most RETRY_KEEP are kept.
_work_of: dict[str, tuple[str, int, RenderTarget]] = {}
RETRY_KEEP = 50


def retry(job_id: str) -> bool:
    """Runs a failed or cancelled job again. False when it can't be (unknown, still running, or from before a restart)."""
    job = get_job(job_id)
    work = _work_of.get(job_id)
    if not job or not work or job.get('status') not in ('failed', 'cancelled'):
        return False
    kind, priority, target = work
    update_job(job_id, done=False, status='queued', error=None, progress=0, phase='Waiting in the queue')
    _save(job_id, "UPDATE render_jobs SET status = ?, error = NULL, finished_at = NULL WHERE id = ?", ('queued',))
    _cancel_events[job_id] = threading.Event()
    lane = lane_of(kind)
    _lane_of_job[job_id] = lane
    _queues[lane].put((priority, next(_order), job_id, target))
    _ensure_worker(lane)
    return True


def can_retry(job_id: str) -> bool:
    return job_id in _work_of


def _ensure_worker(lane: str, fresh: bool = False) -> None:
    with _worker_lock:
        if fresh:
            _generation[lane] += 1
            _running[lane] = None
        worker = _workers[lane]
        if fresh or worker is None or not worker.is_alive():
            _workers[lane] = threading.Thread(target=_work, args=(lane, _generation[lane]), daemon=True, name=f'render-queue-{lane}')
            _workers[lane].start()


def _finish(job_id: str, status: str, *, error: str | None = None, **fields: Any) -> None:
    job = get_job(job_id)
    if job and job.get('done'):
        return  # Already settled: a cancel freed its lane, and this is the old step finishing.
    _lane_of_job.pop(job_id, None)
    update_job(job_id, done=True, status=status, error=error, **fields)
    _save(job_id, "UPDATE render_jobs SET status = ?, error = ?, output_photo_id = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?",
          (status, error, fields.get('output_photo_id')))
    _cancel_events.pop(job_id, None)
    if status == 'done':
        _work_of.pop(job_id, None)
    while len(_work_of) > RETRY_KEEP:
        _work_of.pop(next(iter(_work_of)))
    prune_finished_jobs()


def _work(lane: str, generation: int) -> None:
    while _generation[lane] == generation:
        try:
            _, _, job_id, target = _queues[lane].get(timeout=0.5)
        except queue.Empty:
            continue
        if _generation[lane] != generation:  # Retired while waiting: hand the job back to the lane's new worker.
            _queues[lane].put((0, next(_order), job_id, target))
            return
        cancel = _cancel_events.get(job_id)
        if cancel is None or cancel.is_set():
            continue
        _running[lane] = job_id
        update_job(job_id, status='running', phase=None)
        _save(job_id, 'UPDATE render_jobs SET status = ? WHERE id = ?', ('running',))
        try:
            _finish(job_id, 'done', **target(cancel.is_set))
        except JobCancelled:
            _finish(job_id, 'cancelled', error=CANCELLED_MESSAGE)
        except Exception as exc:
            logger.exception('Render job %s failed', job_id)
            _finish(job_id, 'failed', error=str(exc))
        finally:
            if _running[lane] == job_id:
                _running[lane] = None


def cancel_render(job_id: str) -> bool:
    """Returns False when the job isn't waiting or running."""
    job = get_job(job_id)
    cancel = _cancel_events.get(job_id)
    if job is None or cancel is None or job.get('done'):
        return False
    cancel.set()
    if job.get('status') == 'queued':
        _finish(job_id, 'cancelled', error=CANCELLED_MESSAGE)
    else:
        # Running: settle it now and give its lane a new worker, so the jobs behind it start at once.
        lane = _lane_of_job.get(job_id)
        _finish(job_id, 'cancelled', error=CANCELLED_MESSAGE)
        if lane and _running[lane] == job_id:
            _ensure_worker(lane, fresh=True)
    return True


def _describe(row: Any) -> dict[str, Any]:
    job = get_job(row['id']) or {}
    return {
        'job_id': row['id'], 'kind': row['kind'], 'label': row['label'], 'status': job.get('status', row['status']),
        'progress': job.get('progress', 100 if row['status'] == 'done' else 0), 'total': job.get('total', 100),
        'done': job.get('done', row['status'] not in ACTIVE_STATUSES), 'phase': job.get('phase'),
        'error': job.get('error', row['error']), 'output_photo_id': job.get('output_photo_id', row['output_photo_id']),
    }


def list_render_jobs() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute('SELECT * FROM render_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?', (RECENT_JOB_LIMIT,)).fetchall()
    return [_describe(row) for row in rows]


def get_stored_render_job(job_id: str) -> dict[str, Any] | None:
    """A job from before a restart: gone from memory, still on record."""
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM render_jobs WHERE id = ?', (job_id,)).fetchone()
    return _describe(row) if row else None


def recover_after_restart() -> None:
    """Runs at startup, when nothing can still be running: closes old jobs and clears their leftovers."""
    with get_connection() as conn:
        placeholders = ','.join('?' * len(ACTIVE_STATUSES))
        conn.execute(f"UPDATE render_jobs SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE status IN ({placeholders})", (INTERRUPTED_MESSAGE, *ACTIVE_STATUSES))
        conn.execute('DELETE FROM render_jobs WHERE id NOT IN (SELECT id FROM render_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?)', (KEPT_JOB_RECORDS,))
        conn.commit()
        recipes = [row['recipe'] for row in conn.execute("SELECT recipe FROM projects WHERE recipe IS NOT NULL").fetchall()]
    for folder in settings.edit_workspace_dir.glob('.video-export-*'):
        shutil.rmtree(folder, ignore_errors=True)
    audio_dir = settings.data_dir / 'video_audio'
    if audio_dir.is_dir():
        cutoff = time.time() - AUDIO_RETENTION_SECONDS
        for asset in audio_dir.iterdir():
            # Songs a saved project still uses stay, however old they are.
            if asset.is_file() and asset.stat().st_mtime < cutoff and not any(asset.name in recipe for recipe in recipes):
                asset.unlink(missing_ok=True)
