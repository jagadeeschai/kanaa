"""Local ASR worker, isolated from OpenCV's native FFmpeg libraries on macOS."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

import numpy as np


def transcribe_words(audio: Path, model_name: str, cache: Path, language: str | None, on_progress: Callable[..., None], *, model=None, speech: bool = False) -> list[dict]:
    on_progress(progress=1, phase='Loading speech model (first use may download it)')
    if model is None:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise ValueError('Install the backend requirements to enable automatic lyric syncing.') from exc
        model = WhisperModel(model_name, device='cpu', compute_type='int8', download_root=str(cache), cpu_threads=4)
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('Automatic syncing requires ffmpeg.')
    # Decode with the installed FFmpeg, avoiding PyAV API/version differences.
    decoded = subprocess.run([ffmpeg, '-v', 'error', '-i', str(audio), '-vn', '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'], capture_output=True, check=True, timeout=180)
    samples = np.frombuffer(decoded.stdout, dtype=np.float32).copy()
    if not samples.size:
        raise ValueError('The song has no readable audio samples.')
    duration = len(samples) / 16000
    on_progress(progress=5, phase='Listening to the vocals')
    # No lyric prompt: hallucinated text must never count as an audio match.
    if speech:
        # For talking videos. One pass at one temperature measured 14x faster on Tamil, with the same words.
        segments, _ = model.transcribe(samples, language=language or None, word_timestamps=True, vad_filter=True, beam_size=1, temperature=0, condition_on_previous_text=False)
    else:
        segments, _ = model.transcribe(samples, language=language or None, word_timestamps=True, vad_filter=False, beam_size=5, condition_on_previous_text=False)
    words = []
    for segment in segments:
        words.extend({'word': word.word, 'start': word.start, 'end': word.end} for word in segment.words or [])
        on_progress(progress=min(90, 5 + int(segment.end / duration * 85)), phase='Listening to the vocals')
    return words


if __name__ == '__main__':
    def emit(**values):
        print(json.dumps(values, ensure_ascii=False), flush=True)
    try:
        words = transcribe_words(Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]), sys.argv[4] or None, emit, speech=sys.argv[5:] == ['speech'])
        emit(words=words)
    except Exception as exc:
        emit(error=str(exc))
        raise SystemExit(1)
