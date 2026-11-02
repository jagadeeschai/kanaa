from __future__ import annotations

import logging
import subprocess
import threading
import time
import uuid
from typing import Any, Callable

logger = logging.getLogger(__name__)

FINISHED_JOBS_KEPT = 200

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


class JobCancelled(Exception):
    """The user cancelled the running job."""


def create_job(kind: str, **initial: Any) -> str:
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "kind": kind,
            "progress": 0,
            "total": 0,
            "done": False,
            "error": None,
            **initial,
        }
    return job_id


def update_job(job_id: str, **kwargs: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job.update(kwargs)


def get_job(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job is not None else None


def prune_finished_jobs() -> None:
    with _jobs_lock:
        finished = [job_id for job_id, job in _jobs.items() if job.get('done')]
        for job_id in finished[:-FINISHED_JOBS_KEPT]:
            del _jobs[job_id]


def stop_process_when(process: subprocess.Popen, should_stop: Callable[[], bool]) -> threading.Thread:
    """Watches a blocking subprocess from a side thread and ends it once should_stop() is true."""
    def _watch() -> None:
        while process.poll() is None:
            if should_stop():
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                return
            time.sleep(0.25)

    thread = threading.Thread(target=_watch, daemon=True)
    thread.start()
    return thread


def run_in_background(target: Callable[[], None], job_id: str | None = None) -> None:
    def _run() -> None:
        try:
            target()
        except Exception as exc:
            logger.exception("Background job %s failed", job_id)
            if job_id is not None:
                update_job(job_id, done=True, error=str(exc))

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
