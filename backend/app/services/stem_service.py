"""Splits a song into voice and music with Demucs, an optional add-on in its own Python environment."""
from __future__ import annotations

import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from app.core.config import settings
from app.services.asset_service import content_key
from app.services.job_service import JobCancelled, stop_process_when
from app.services.video_edit_service import run_cancellable

logger = logging.getLogger(__name__)

STEMS_PYTHON = Path(os.getenv('WIDEANGLE_MOTION_STEMS_PYTHON', str(Path(__file__).resolve().parents[2] / '.stems' / 'bin' / 'python')))
STEM_MODEL = 'htdemucs'
STEM_FILES = {'vocals': 'vocals.wav', 'music': 'no_vocals.wav'}
INSTALL_COMMAND = './install-stems.sh'


def stems_available() -> bool:
    return STEMS_PYTHON.is_file()


def stem_id(key: str, stem: str) -> str:
    return hashlib.sha256(f'{key}:{STEM_MODEL}:{stem}'.encode()).hexdigest()[:32]


def run_demucs(source: Path, output: Path, device: str, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> tuple[int, str]:
    env = {**os.environ, 'TORCH_HOME': str(settings.model_cache_dir / 'torch'), 'PYTORCH_ENABLE_MPS_FALLBACK': '1'}
    process = subprocess.Popen([str(STEMS_PYTHON), '-m', 'demucs', '--two-stems=vocals', '-n', STEM_MODEL, '-d', device, '-o', str(output), str(source)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors='replace', env=env)
    stop_process_when(process, should_cancel)
    assert process.stderr is not None
    tail, line = '', ''
    # tqdm redraws one line with carriage returns, so read characters.
    while character := process.stderr.read(1):
        if character in '\r\n':
            if found := re.match(r'\s*(\d+)%\|', line):
                on_progress(int(found.group(1)))
            tail = (tail + line + '\n')[-1500:]
            line = ''
        else:
            line += character
    return process.wait(), tail


def separate(source: Path, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> dict[str, str]:
    """Returns audio asset ids for each stem. Results are kept, so a song is only separated once."""
    if not stems_available():
        raise ValueError(f'Voice separation is not installed. Run {INSTALL_COMMAND} in the Motion folder, then restart Motion.')
    key = content_key(source)
    ids = {stem: stem_id(key, stem) for stem in STEM_FILES}
    directory = settings.data_dir / 'video_audio'
    directory.mkdir(parents=True, exist_ok=True)
    if all((directory / asset).is_file() for asset in ids.values()):
        return ids
    with tempfile.TemporaryDirectory(prefix='.stems-', dir=settings.data_dir) as folder:
        folder = Path(folder)
        song = folder / 'song.wav'
        decoded = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(source), '-vn', '-ac', '2', '-ar', '44100', str(song)], should_cancel)
        if decoded.returncode:
            logger.error('Could not decode for separation: %s', decoded.stderr[-500:])
            raise RuntimeError('This sound could not be read.')
        # The Mac GPU is faster, but some models and systems refuse it; the CPU always works.
        for device in ('mps', 'cpu'):
            code, log = run_demucs(song, folder / 'out', device, on_progress, should_cancel)
            if should_cancel():
                raise JobCancelled()
            if code == 0:
                break
            logger.warning('Demucs failed on %s: %s', device, log[-800:])
        else:
            raise RuntimeError('Voice separation failed. See the server log for details.')
        for stem, name in STEM_FILES.items():
            os.replace(folder / 'out' / STEM_MODEL / 'song' / name, directory / ids[stem])
    return ids
