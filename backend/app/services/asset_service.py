"""Editing copies of each clip: a light proxy, a filmstrip and waveform peaks. Originals stay untouched."""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

import numpy as np

from app.core.config import settings
from app.services.job_service import get_job, update_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.render_queue_service import BACKGROUND_PRIORITY, enqueue_render
from app.services.video_edit_service import HDR_TO_BT709, run_cancellable

logger = logging.getLogger(__name__)

SAMPLE_BYTES = 1024 * 1024
PROXY_HEIGHT = 720
PROXY_GOP = 15  # Short groups of pictures keep scrubbing quick.
PROXY_BITS = '3M'
FILMSTRIP_TILE_HEIGHT = 90
MAX_FILMSTRIP_TILES = 120
SECONDS_PER_TILE = 2
PEAK_SAMPLE_RATE = 8000
PEAKS_PER_SECOND = 20
GIGABYTE = 1024 ** 3
_active: dict[str, str] = {}


def content_key(path: Path) -> str:
    """Identifies a file by its size and its first and last megabyte, without reading all of it."""
    size = path.stat().st_size
    digest = hashlib.sha256(str(size).encode())
    with path.open('rb') as file:
        digest.update(file.read(SAMPLE_BYTES))
        if size > SAMPLE_BYTES:
            file.seek(max(SAMPLE_BYTES, size - SAMPLE_BYTES))
            digest.update(file.read(SAMPLE_BYTES))
    return digest.hexdigest()[:32]


def cache_root() -> Path:
    return settings.data_dir / 'cache'


def cache_limit_bytes() -> int:
    return int(float(os.getenv('WIDEANGLE_MOTION_CACHE_GB', '5')) * GIGABYTE)


def folder_for(key: str) -> Path:
    return cache_root() / key


def manifest_for(key: str) -> dict[str, Any] | None:
    try:
        manifest = json.loads((folder_for(key) / 'manifest.json').read_text())
    except (OSError, ValueError):
        return None
    os.utime(folder_for(key))  # Marks it recently used.
    return manifest


def folder_size(folder: Path) -> int:
    return sum(path.stat().st_size for path in folder.iterdir() if path.is_file())


def prune_cache(keep: str | None = None, limit: int | None = None) -> None:
    """Removes the least recently used clips first. Everything here can be rebuilt."""
    limit = cache_limit_bytes() if limit is None else limit
    root = cache_root()
    if not root.is_dir():
        return
    folders = sorted((folder for folder in root.iterdir() if folder.is_dir()), key=lambda folder: folder.stat().st_mtime)
    total = sum(folder_size(folder) for folder in folders)
    for folder in folders:
        if total <= limit:
            break
        if folder.name != keep and folder.name not in _active:
            total -= folder_size(folder)
            shutil.rmtree(folder, ignore_errors=True)


def video_encoder_args() -> list[str]:
    return ['-c:v', 'h264_videotoolbox', '-b:v', PROXY_BITS] if shutil.which('ffmpeg') and has_videotoolbox() else ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26']


def has_videotoolbox() -> bool:
    result = subprocess.run([shutil.which('ffmpeg'), '-hide_banner', '-encoders'], capture_output=True, text=True)
    return 'h264_videotoolbox' in result.stdout


def proxy_filters(facts: MediaFacts) -> str:
    steps = [HDR_TO_BT709] if facts.is_hdr else []
    steps += [f"scale='if(gt(iw,ih),-2,{PROXY_HEIGHT})':'if(gt(iw,ih),{PROXY_HEIGHT},-2)'", 'fps=30', 'format=yuv420p']
    return ','.join(steps)


def make_proxy(facts: MediaFacts, target: Path, should_cancel: Callable[[], bool]) -> None:
    temporary = target.with_suffix('.tmp.mp4')
    audio = ['-c:a', 'aac', '-b:a', '128k'] if facts.has_audio else ['-an']
    base = [shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(facts.path), '-vf', proxy_filters(facts), '-map', '0:v:0', '-map', '0:a:0?']
    tail = ['-g', str(PROXY_GOP), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', *audio, '-movflags', '+faststart', str(temporary)]
    result = run_cancellable([*base, *video_encoder_args(), *tail], should_cancel)
    if result.returncode:
        # The hardware encoder can refuse unusual sizes; software always works.
        result = run_cancellable([*base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', *tail], should_cancel)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        logger.error('Proxy failed for %s: %s', facts.path, result.stderr[-800:])
        raise RuntimeError('Could not prepare this clip for editing.')
    temporary.replace(target)


def make_filmstrip(facts: MediaFacts, target: Path, should_cancel: Callable[[], bool]) -> dict[str, Any]:
    duration = facts.duration or 1
    tiles = max(1, min(MAX_FILMSTRIP_TILES, math.ceil(duration / SECONDS_PER_TILE)))
    width = max(2, round(FILMSTRIP_TILE_HEIGHT * (facts.width or 16) / (facts.height or 9) / 2) * 2)
    temporary = target.with_suffix('.tmp.jpg')
    result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(target.parent / 'proxy.mp4'), '-vf',
                              f'fps={tiles}/{duration},scale={width}:{FILMSTRIP_TILE_HEIGHT},tile={tiles}x1', '-frames:v', '1', '-q:v', '5', str(temporary)], should_cancel)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        logger.error('Filmstrip failed for %s: %s', facts.path, result.stderr[-800:])
        raise RuntimeError('Could not build the filmstrip for this clip.')
    temporary.replace(target)
    return {'tiles': tiles, 'tile_width': width, 'tile_height': FILMSTRIP_TILE_HEIGHT}


def peaks_from_samples(samples: np.ndarray, bucket: int) -> list[int]:
    """The loudest point in each bucket, 0-255."""
    if not len(samples):
        return []
    count = max(1, len(samples) // bucket)
    peaks = np.abs(samples[:count * bucket]).reshape(count, bucket).max(axis=1)
    return [int(value) for value in np.clip(peaks * 255, 0, 255).astype(np.uint8)]


def make_peaks(facts: MediaFacts, target: Path) -> None:
    peaks: list[int] = []
    if facts.has_audio:
        decoded = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-i', str(facts.path), '-vn', '-ac', '1', '-ar', str(PEAK_SAMPLE_RATE), '-f', 'f32le', '-'], capture_output=True)
        if decoded.returncode == 0:
            peaks = peaks_from_samples(np.frombuffer(decoded.stdout, dtype=np.float32), PEAK_SAMPLE_RATE // PEAKS_PER_SECOND)
    target.write_text(json.dumps({'peaks_per_second': PEAKS_PER_SECOND, 'peaks': peaks}))


def prepare_assets(facts: MediaFacts, key: str, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> None:
    folder = folder_for(key)
    folder.mkdir(parents=True, exist_ok=True)
    make_proxy(facts, folder / 'proxy.mp4', should_cancel)
    on_progress(80)
    filmstrip = make_filmstrip(facts, folder / 'filmstrip.jpg', should_cancel)
    on_progress(90)
    make_peaks(facts, folder / 'peaks.json')
    # Written last, so its presence means every file is complete.
    (folder / 'manifest.json').write_text(json.dumps({'version': 1, 'width': facts.width, 'height': facts.height, 'duration': facts.duration, 'fps': facts.fps, 'filmstrip': filmstrip}))


def request_assets(path: Path, label: str) -> dict[str, Any]:
    """Returns what exists now, starting the background job if nothing does yet."""
    key = content_key(path)
    manifest = manifest_for(key)
    if manifest:
        return {'status': 'ready', 'key': key, **manifest}
    active = _active.get(key)
    job = get_job(active) if active else None
    if job and not job.get('done'):
        return {'status': 'preparing', 'key': key, 'job_id': active, 'progress': job.get('progress', 0)}
    facts = probe_video(path)
    if facts is None:
        return {'status': 'unavailable', 'key': key}

    def run(should_cancel: Callable[[], bool]) -> dict[str, Any]:
        try:
            shutil.rmtree(folder_for(key), ignore_errors=True)
            prepare_assets(facts, key, lambda value: update(value), should_cancel)
        except BaseException:
            shutil.rmtree(folder_for(key), ignore_errors=True)
            raise
        finally:
            _active.pop(key, None)
        prune_cache(keep=key)
        return {'progress': 100}

    def update(value: int) -> None:
        update_job(_active.get(key, ''), progress=value)

    # Registered before the job starts, so a fast worker can't finish first.
    job_id = enqueue_render('media_prep', f'Preparing {label}', run, priority=BACKGROUND_PRIORITY, total=100, reserve=lambda identifier: _active.__setitem__(key, identifier))
    return {'status': 'preparing', 'key': key, 'job_id': job_id, 'progress': 0}
