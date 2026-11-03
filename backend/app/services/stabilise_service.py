"""Steadies shaky video with vid.stab, in two passes. The steady copy is made once and kept with the clip's other prepared files."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Callable

from app.services.asset_service import content_key, folder_for, make_proxy
from app.services.job_service import JobCancelled, get_job, update_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.render_queue_service import BACKGROUND_PRIORITY, enqueue_render
from app.services.reverse_service import lock_for
from app.services.video_edit_service import BT709_OUTPUT_ARGS, HDR_TO_BT709, SD_COLOR_SPACES, TO_BT709, run_cancellable

logger = logging.getLogger(__name__)
STABLE = 'stable.mp4'
STABLE_PROXY = 'stable-proxy.mp4'
# Smoothing is in frames either side: about two thirds of a second keeps intended pans while removing hand shake.
# Text format: the binary one can't be read back by this vid.stab build ("Cannot parse localmotion").
DETECT = 'vidstabdetect=shakiness=6:accuracy=12:result=transforms.trf:fileformat=ascii'
TRANSFORM = 'vidstabtransform=input=transforms.trf:smoothing=20:optzoom=1:zoomspeed=0.1:interpol=bicubic,unsharp=5:5:0.5:3:3:0'
_active: dict[str, str] = {}


def stable_files(source: Path) -> tuple[Path, Path]:
    folder = folder_for(content_key(source))
    return folder / STABLE, folder / STABLE_PROXY


def is_ready(source: Path) -> bool:
    return all(path.is_file() for path in stable_files(source))


def make_stable(facts: MediaFacts, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> None:
    """Finds the shake, then removes it. The copy keeps every frame at its time, in standard colour like a proxy."""
    full, proxy = stable_files(facts.path)
    full.parent.mkdir(parents=True, exist_ok=True)
    work = full.parent / 'steadying'
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    try:
        colour = HDR_TO_BT709 if facts.is_hdr else TO_BT709 if facts.color_space in SD_COLOR_SPACES else 'format=yuv420p'
        ffmpeg = [shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(facts.path), '-an']
        for step, (filters, output) in enumerate(((f'{colour},{DETECT}', ['-f', 'null', '-']),
                                                  (f'{colour},{TRANSFORM}', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', *BT709_OUTPUT_ARGS, 'steady.mp4']))):
            result = run_cancellable([*ffmpeg, '-vf', filters, *output], should_cancel, cwd=work)
            if should_cancel():
                raise JobCancelled()
            if result.returncode:
                logger.error('Steadying failed for %s: %s', facts.path, result.stderr[-800:])
                raise RuntimeError('Could not steady this clip.')
            on_progress((step + 1) * 45)
        steady = probe_video(work / 'steady.mp4')
        if steady is None:
            raise RuntimeError('Could not steady this clip.')
        make_proxy(steady, work / 'proxy.mp4', should_cancel)
        # The full copy last: its presence, with the proxy's, means both are complete.
        (work / 'proxy.mp4').replace(proxy)
        (work / 'steady.mp4').replace(full)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def ensure_stable(facts: MediaFacts, should_cancel: Callable[[], bool] = lambda: False) -> MediaFacts:
    """The steady copy's facts, making it first if needed, so export never uses the shaky original by mistake."""
    with lock_for(content_key(facts.path)):
        if not is_ready(facts.path):
            make_stable(facts, lambda _: None, should_cancel)
    steady = probe_video(stable_files(facts.path)[0])
    if steady is None:
        raise RuntimeError('The steady copy of this clip could not be read.')
    return steady


def request_stable(facts: MediaFacts, label: str) -> dict:
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
                    make_stable(facts, lambda value: update_job(_active.get(key, ''), progress=value), should_cancel)
        finally:
            _active.pop(key, None)
        return {'progress': 100}

    job_id = enqueue_render('stabilise', f'Steadying {label}', run, priority=BACKGROUND_PRIORITY, total=100, reserve=lambda identifier: _active.__setitem__(key, identifier))
    return {'status': 'preparing', 'job_id': job_id, 'progress': 0}
