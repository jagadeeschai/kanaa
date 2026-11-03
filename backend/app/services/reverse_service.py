"""A clip played backwards needs its frames in reverse order. A reversed copy is made once and kept with the clip's other prepared files."""
from __future__ import annotations

import logging
import math
import shutil
import threading
from pathlib import Path
from typing import Callable

from app.services.asset_service import content_key, folder_for, make_proxy
from app.services.job_service import JobCancelled, get_job, update_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.render_queue_service import BACKGROUND_PRIORITY, enqueue_render
from app.services.video_edit_service import BT709_OUTPUT_ARGS, HDR_TO_BT709, SD_COLOR_SPACES, TO_BT709, run_cancellable

logger = logging.getLogger(__name__)
REVERSED = 'reversed.mp4'
REVERSED_PROXY = 'reversed-proxy.mp4'
PIECE_SECONDS = 2  # ffmpeg reverses a piece in memory, so pieces stay short.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_active: dict[str, str] = {}


def lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def reversed_files(source: Path) -> tuple[Path, Path]:
    folder = folder_for(content_key(source))
    return folder / REVERSED, folder / REVERSED_PROXY


def is_ready(source: Path) -> bool:
    return all(path.is_file() for path in reversed_files(source))


def make_reversed(facts: MediaFacts, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> None:
    """Reverses each short piece, then joins the pieces last first. The copy is already standard colour, like a proxy."""
    full, proxy = reversed_files(facts.path)
    full.parent.mkdir(parents=True, exist_ok=True)
    work = full.parent / 'reversing'
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    try:
        colour = [HDR_TO_BT709] if facts.is_hdr else [TO_BT709] if facts.color_space in SD_COLOR_SPACES else ['format=yuv420p']
        count = max(1, math.ceil((facts.duration or 0) / PIECE_SECONDS))
        pieces = []
        for number in range(count):
            piece = work / f'{number:05d}.mp4'
            result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-ss', f'{number * PIECE_SECONDS}', '-t', f'{PIECE_SECONDS}', '-i', str(facts.path),
                                      '-an', '-vf', ','.join([*colour, 'reverse']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', *BT709_OUTPUT_ARGS, str(piece)], should_cancel)
            if should_cancel():
                raise JobCancelled()
            if result.returncode:
                logger.error('Reversing failed for %s: %s', facts.path, result.stderr[-800:])
                raise RuntimeError('Could not reverse this clip.')
            pieces.append(piece)
            on_progress(min(80, (number + 1) * 80 // count))
        (work / 'pieces.txt').write_text(''.join(f"file '{piece.name}'\n" for piece in reversed(pieces)))
        joined = work / 'joined.mp4'
        result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(work / 'pieces.txt'), '-c', 'copy', '-movflags', '+faststart', str(joined)], should_cancel)
        if result.returncode:
            logger.error('Joining the reversed pieces failed: %s', result.stderr[-800:])
            raise RuntimeError('Could not reverse this clip.')
        facts_reversed = probe_video(joined)
        if facts_reversed is None:
            raise RuntimeError('Could not reverse this clip.')
        make_proxy(facts_reversed, work / 'proxy.mp4', should_cancel)
        on_progress(99)
        # The full copy last: its presence, with the proxy's, means both are complete.
        (work / 'proxy.mp4').replace(proxy)
        joined.replace(full)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def ensure_reversed(facts: MediaFacts, should_cancel: Callable[[], bool] = lambda: False) -> MediaFacts:
    """The reversed copy's facts, making the copy first if needed. Export calls this, so a clip is never exported forwards by mistake."""
    key = content_key(facts.path)
    with lock_for(key):
        if not is_ready(facts.path):
            make_reversed(facts, lambda _: None, should_cancel)
    reversed_facts = probe_video(reversed_files(facts.path)[0])
    if reversed_facts is None:
        raise RuntimeError('The reversed copy of this clip could not be read.')
    return reversed_facts


def request_reversed(facts: MediaFacts, label: str) -> dict:
    """Ready, or being made in the background."""
    key = content_key(facts.path)
    if is_ready(facts.path):
        return {'status': 'ready'}
    active = _active.get(key)
    job = get_job(active) if active else None
    if job and not job.get('done'):
        return {'status': 'preparing', 'job_id': active, 'progress': job.get('progress', 0)}

    def run(should_cancel: Callable[[], bool]) -> dict:
        try:
            with lock_for(key):
                if not is_ready(facts.path):
                    make_reversed(facts, lambda value: update_job(_active.get(key, ''), progress=value), should_cancel)
        finally:
            _active.pop(key, None)
        return {'progress': 100}

    job_id = enqueue_render('reverse', f'Reversing {label}', run, priority=BACKGROUND_PRIORITY, total=100, reserve=lambda identifier: _active.__setitem__(key, identifier))
    return {'status': 'preparing', 'job_id': job_id, 'progress': 0}
