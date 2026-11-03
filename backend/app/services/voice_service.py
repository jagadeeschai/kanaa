"""Clean voice: background noise out of speech, made once per sound file with ffmpeg's own noise filter.

The cleaned sound is a whole-file copy kept with the source's other prepared files. Preview and export both play it,
so they sound the same. Cleaning a stretch on the fly would not: the filter learns the noise as it goes.

Tested on a real voice (an 11-second speech recording) with added hiss and fan noise, the built-in filter brought the
voice closest to the clean recording at full level. RNNoise, a speech-noise network, turned the voice down by 6 dB
and left more noise, and a compressor afterwards only made speech quieter, so neither is used.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Callable

from app.services.asset_service import content_key, folder_for
from app.services.job_service import get_job
from app.services.render_queue_service import BACKGROUND_PRIORITY, enqueue_render
from app.services.reverse_service import lock_for
from app.services.video_edit_service import run_cancellable

logger = logging.getLogger(__name__)
CLEAN = 'clean-voice.flac'
FILTER_DELAY = 1199  # Samples at 48 kHz the noise filter runs late, trimmed off the start and padded back at the end.
# Rumble under the voice goes, then steady noise (fans, AC, traffic, hiss) is learnt and lowered by up to 24 dB.
VOICE_FILTERS = ','.join([
    'aresample=48000',
    'highpass=f=80',
    'afftdn=nr=24:nf=-30:tn=1',
    f'atrim=start_sample={FILTER_DELAY}',
    'asetpts=PTS-STARTPTS',
    f'apad=pad_len={FILTER_DELAY}',
])
_active: dict[str, str] = {}


def clean_file(source: Path) -> Path:
    return folder_for(content_key(source)) / CLEAN


def is_ready(source: Path) -> bool:
    return clean_file(source).is_file()


def make_clean(source: Path, should_cancel: Callable[[], bool]) -> None:
    target = clean_file(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.flac')
    result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(source), '-vn', '-af', VOICE_FILTERS, '-c:a', 'flac', str(temporary)], should_cancel)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        logger.error('Clean voice failed for %s: %s', source, result.stderr[-800:])
        raise RuntimeError('Could not clean the voice in this sound.')
    temporary.replace(target)


def ensure_clean(source: Path, should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """The cleaned copy, made first if needed, so export never uses the noisy original by mistake."""
    with lock_for(content_key(source)):
        if not is_ready(source):
            make_clean(source, should_cancel)
    return clean_file(source)


def request_clean(source: Path, label: str) -> dict:
    """Ready, or being made in the background."""
    key = content_key(source)
    if is_ready(source):
        return {'status': 'ready'}
    active = _active.get(key)
    job = get_job(active) if active else None
    if job and not job.get('done'):
        return {'status': 'preparing', 'job_id': active}

    def run(should_cancel: Callable[[], bool]) -> dict:
        try:
            ensure_clean(source, should_cancel)
        finally:
            _active.pop(key, None)
        return {'progress': 100}

    job_id = enqueue_render('clean_voice', f'Cleaning the voice in {label}', run, priority=BACKGROUND_PRIORITY, total=100, reserve=lambda identifier: _active.__setitem__(key, identifier))
    return {'status': 'preparing', 'job_id': job_id}
