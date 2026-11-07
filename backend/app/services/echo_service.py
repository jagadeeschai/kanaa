"""The preview's copy of a clip with an echo trail.

An echo blends each frame with the ones before it, which the WebGL preview cannot do from a single video frame. The
export blends frames inline (timeline_service.echo_filter); the preview plays this copy, made once in the background
with exactly the same filter at the same frame rate, so the two show the same trail. Kept with the clip's other
prepared files.
"""
from __future__ import annotations

import hashlib
import logging
import re
import shutil
import threading
from pathlib import Path
from typing import Callable

from app.services.asset_service import content_key, folder_for, proxy_filters
from app.services.job_service import get_job, update_job
from app.services.media_probe import MediaFacts
from app.services.render_queue_service import BACKGROUND_PRIORITY, enqueue_render
from app.services.timeline_schema import Echo
from app.services.video_edit_service import run_cancellable

logger = logging.getLogger(__name__)
# echo.4.0.60@30 or smear.2.0.85@60: mode, trails, decay, then the timeline's frames per second of source.
TOKEN = re.compile(r'^(echo|smear)\.([2-8])\.(\d\.\d{2})@(\d{1,3}(?:\.\d{1,3})?)$')
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
_active: dict[str, str] = {}


def token(effect: Echo, rate: float) -> str:
    return f'{effect.mode}.{effect.trails}.{effect.decay:.2f}@{round(rate, 3):g}'


def parse(value: str) -> tuple[Echo, float] | None:
    """The echo and the rate it is made at, or None for a token that was not made by `token`."""
    found = TOKEN.match(value or '')
    if not found:
        return None
    mode, trails, decay, rate = found.groups()
    if not (.2 <= float(decay) <= .95 and 1 <= float(rate) <= 480):
        return None
    return Echo(mode=mode, trails=int(trails), decay=float(decay)), float(rate)


def echo_path(source: Path, value: str) -> Path:
    digest = hashlib.sha256(value.encode()).hexdigest()[:12]
    return folder_for(content_key(source)) / f'echo-{digest}-proxy.mp4'


def _lock(key: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(key, threading.Lock())


def make_echo(facts: MediaFacts, value: str, should_cancel: Callable[[], bool]) -> Path:
    from app.services.timeline_service import echo_filter
    parsed = parse(value)
    if parsed is None:
        raise ValueError('Unknown echo.')
    effect, rate = parsed
    target = echo_path(facts.path, value)
    if target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    # The proxy's size and colour, but at the timeline's rate of source frames, then the export's own blend.
    steps = [step for step in proxy_filters(facts).split(',') if not step.startswith('fps=')]
    vf = ','.join([*steps[:-1], f'fps={rate:g}', echo_filter(effect), steps[-1]])
    result = run_cancellable([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(facts.path), '-an', '-vf', vf,
                              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '15', '-movflags', '+faststart', str(temporary)], should_cancel)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        logger.error('Echo copy failed for %s: %s', facts.path, result.stderr[-800:])
        raise RuntimeError('Could not make the echo trail for this clip.')
    temporary.replace(target)
    return target


def request_echo(facts: MediaFacts, value: str, label: str) -> dict:
    """Ready, or being made in the background."""
    if parse(value) is None:
        raise RuntimeError('Unknown echo.')
    target = echo_path(facts.path, value)
    if target.is_file():
        return {'status': 'ready'}
    key = str(target)
    active = _active.get(key)
    job = get_job(active) if active else None
    if job and not job.get('done'):
        return {'status': 'preparing', 'job_id': active, 'progress': job.get('progress', 0)}

    def run(should_cancel: Callable[[], bool]) -> dict:
        try:
            with _lock(key):
                make_echo(facts, value, should_cancel)
        finally:
            _active.pop(key, None)
        return {'progress': 100}

    job_id = enqueue_render('echo', f'Echo trail for {label}', run, priority=BACKGROUND_PRIORITY, total=100, reserve=lambda identifier: _active.__setitem__(key, identifier))
    return {'status': 'preparing', 'job_id': job_id, 'progress': 0}
