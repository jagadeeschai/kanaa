"""Word-by-word transcripts for editing by text. Kept with the clip's other prepared files."""
from __future__ import annotations

import json
import logging
import sys
import tempfile
from pathlib import Path
import subprocess
from typing import Callable

from app.core.config import settings
from app.services.asset_service import content_key, folder_for
from app.services.job_service import JobCancelled, stop_process_when

logger = logging.getLogger(__name__)
LANGUAGES = {'auto', 'ta', 'en', 'hi', 'te', 'ml', 'kn'}
PHASE = 'Listening to your video'


def transcript_file(source: Path, language: str) -> Path:
    return folder_for(content_key(source)) / f'words-{language}.json'


def saved_words(source: Path, language: str) -> list[dict] | None:
    target = transcript_file(source, language)
    return json.loads(target.read_text(encoding='utf-8')) if target.is_file() else None


def clean_words(words: list[dict]) -> list[dict]:
    """Whisper can repeat a time or leave a blank. Word cuts need times that always move forward."""
    cleaned: list[dict] = []
    for word in words:
        text = word['word'].strip()
        start = max(float(word['start']), cleaned[-1]['e'] if cleaned else 0)
        end = float(word['end'])
        if text and end > start:
            cleaned.append({'w': text, 's': round(start, 3), 'e': round(end, 3)})
    return cleaned


def transcribe(source: Path, language: str, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> list[dict]:
    backend = Path(__file__).resolve().parents[2]
    args = [sys.executable, '-m', 'app.services.lyric_transcription_worker', str(source.resolve()), settings.lyric_sync_model, str((settings.model_cache_dir / 'whisper').resolve()), '' if language == 'auto' else language, 'speech']
    with tempfile.TemporaryFile(mode='w+') as errors:
        process = subprocess.Popen(args, cwd=backend, stdout=subprocess.PIPE, stderr=errors, text=True)
        stop_process_when(process, should_cancel)
        words, problem = None, None
        try:
            assert process.stdout is not None
            for line in process.stdout:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if 'progress' in event:
                    on_progress(event['progress'])
                words = event.get('words', words)
                problem = event.get('error', problem)
            code = process.wait()
            if should_cancel():
                raise JobCancelled()
            if code or words is None:
                errors.seek(0)
                logger.error('Transcript failed: %s %s', problem, errors.read()[-800:])
                raise RuntimeError('This clip could not be transcribed. See the server log for details.')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            if process.stdout is not None:
                process.stdout.close()
    cleaned = clean_words(words)
    target = transcript_file(source, language)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(cleaned, ensure_ascii=False), encoding='utf-8')
    temporary.replace(target)
    return cleaned
