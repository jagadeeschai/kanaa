"""One-at-a-time queue for heavy media jobs. Job records survive restarts; running work does not."""
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

_queue: 'queue.PriorityQueue[tuple[int, int, str, RenderTarget]]' = queue.PriorityQueue()
_order = itertools.count()
_cancel_events: dict[str, threading.Event] = {}
_worker: threading.Thread | None = None
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
    if reserve:
        reserve(job_id)
    _queue.put((priority, next(_order), job_id, target))
    _ensure_worker()
    return job_id


def _ensure_worker() -> None:
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_work, daemon=True, name='render-queue')
            _worker.start()


def _finish(job_id: str, status: str, *, error: str | None = None, **fields: Any) -> None:
    update_job(job_id, done=True, status=status, error=error, **fields)
    _save(job_id, "UPDATE render_jobs SET status = ?, error = ?, output_photo_id = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?",
          (status, error, fields.get('output_photo_id')))
    _cancel_events.pop(job_id, None)
    prune_finished_jobs()


def _work() -> None:
    while True:
        _, _, job_id, target = _queue.get()
        cancel = _cancel_events.get(job_id)
        if cancel is None or cancel.is_set():
            continue
        update_job(job_id, status='running', phase=None)
        _save(job_id, 'UPDATE render_jobs SET status = ? WHERE id = ?', ('running',))
        try:
            _finish(job_id, 'done', **target(cancel.is_set))
        except JobCancelled:
            _finish(job_id, 'cancelled', error=CANCELLED_MESSAGE)
        except Exception as exc:
            logger.exception('Render job %s failed', job_id)
            _finish(job_id, 'failed', error=str(exc))


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
        update_job(job_id, status='cancelling', phase='Cancelling')
        _save(job_id, 'UPDATE render_jobs SET status = ? WHERE id = ?', ('cancelling',))
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
        recipes = [row['recipe'] for row in conn.execute("SELECT recipe FROM projects WHERE recipe IS NOT NULL AND kind = 'lyric'").fetchall()]
    for folder in settings.edit_workspace_dir.glob('.video-export-*'):
        shutil.rmtree(folder, ignore_errors=True)
    audio_dir = settings.data_dir / 'video_audio'
    if audio_dir.is_dir():
        cutoff = time.time() - AUDIO_RETENTION_SECONDS
        for asset in audio_dir.iterdir():
            # Songs a saved lyric project still uses stay, however old they are.
            if asset.is_file() and asset.stat().st_mtime < cutoff and not any(asset.name in recipe for recipe in recipes):
                asset.unlink(missing_ok=True)
