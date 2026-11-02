from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
import unicodedata
from pathlib import Path
from typing import Any, Callable

from app.core.config import settings

from app.services.job_service import JobCancelled, stop_process_when

_sync_lock = threading.Lock()
MAX_ESTIMATED_SECONDS_PER_WORD = 0.8
EXACT_SCORE, SOUND_ALIKE_SCORE, MISMATCH_SCORE, GAP_SCORE = 2, 1, -1, -1
MOVE_DIAGONAL, MOVE_UP, MOVE_LEFT = 0, 1, 2
# Roughly half a minute of alignment; well above any real song.
MAX_ALIGNMENT_CELLS = 12_000_000
# Below this a line isn't really found; above the second it needs no review.
MIN_LINE_MATCH = 0.45
CONFIDENT_LINE_MATCH = 0.65
# Letters sung and transcribed interchangeably: Tamil ர/ற, ல/ள/ழ, ன/ண/ந.
SOUND_ALIKE_LETTERS = str.maketrans({'ற': 'ர', 'ள': 'ல', 'ழ': 'ல', 'ண': 'ன', 'ந': 'ன'})
MIN_CUE_SECONDS = 0.05
MIN_SECONDS_PER_LETTER = 0.05
MAX_SECONDS_PER_LETTER = 0.25


def normalize_word(text: str) -> str:
    return ''.join(char for char in unicodedata.normalize('NFKC', text).casefold() if unicodedata.category(char)[0] in {'L', 'M', 'N'})


def align_letters(expected: str, heard: str) -> list[int]:
    """Global alignment by letter: for each expected letter, the heard letter it matched, or -1.

    Letters survive where words don't: singing makes speech recognition merge, split and
    respell words, while most of the letters still line up. Sound-alike letters count as
    close matches, and gaps at either end are free so intros and outros cost nothing.
    """
    folded_expected, folded_heard = expected.translate(SOUND_ALIKE_LETTERS), heard.translate(SOUND_ALIKE_LETTERS)
    width = len(heard) + 1
    previous = [0] * width
    moves = []
    for row in range(1, len(expected) + 1):
        letter, folded = expected[row - 1], folded_expected[row - 1]
        current = [0] * width
        current[0] = previous[0] + GAP_SCORE
        row_moves = bytearray(width)
        row_moves[0] = MOVE_UP
        for column in range(1, width):
            if heard[column - 1] == letter:
                pair = EXACT_SCORE
            elif folded_heard[column - 1] == folded:
                pair = SOUND_ALIKE_SCORE
            else:
                pair = MISMATCH_SCORE
            diagonal, up, left = previous[column - 1] + pair, previous[column] + GAP_SCORE, current[column - 1] + GAP_SCORE
            if diagonal >= up and diagonal >= left:
                current[column], row_moves[column] = diagonal, MOVE_DIAGONAL
            elif up >= left:
                current[column], row_moves[column] = up, MOVE_UP
            else:
                current[column], row_moves[column] = left, MOVE_LEFT
        moves.append(row_moves)
        previous = current
    row, column = len(expected), max(range(width), key=previous.__getitem__)
    matched = [-1] * len(expected)
    while row > 0:
        move = moves[row - 1][column]
        if move == MOVE_DIAGONAL:
            if folded_expected[row - 1] == folded_heard[column - 1]:
                matched[row - 1] = column - 1
            row, column = row - 1, column - 1
        elif move == MOVE_UP or column == 0:
            row -= 1
        else:
            column -= 1
    return matched


def align_lyric_lines(lines: list[str], words: list[dict[str, Any]], duration: float) -> tuple[list[dict[str, Any]], float]:
    """Match the supplied text to real ASR word timestamps; flag estimated lines."""
    line_letters = [normalize_word(line) for line in lines]
    expected = ''.join(line_letters)
    heard_letters: list[str] = []
    letter_times: list[tuple[float, float]] = []
    for word in words:
        token = normalize_word(word['word'])
        start, end = float(word['start']), float(word['end'])
        for position, letter in enumerate(token):
            heard_letters.append(letter)
            letter_times.append((start + (end - start) * position / len(token), start + (end - start) * (position + 1) / len(token)))
    if not expected or len(expected) * max(1, len(heard_letters)) > MAX_ALIGNMENT_CELLS:
        raise ValueError('These lyrics are too long to sync. Use fewer lines per song.')
    matched = align_letters(expected, ''.join(heard_letters)) if heard_letters else [-1] * len(expected)
    cues: list[dict[str, Any] | None] = []
    spans = []
    cursor = 0
    placed_letters = 0
    for line, letters in zip(lines, line_letters):
        spans.append((0, max(1, len(line.split()))))
        hits = [index for index in matched[cursor:cursor + len(letters)] if index >= 0]
        cursor += len(letters)
        share = len(hits) / max(1, len(letters))
        if share < MIN_LINE_MATCH:
            cues.append(None)
            continue
        placed_letters += len(hits)
        start = max(0.0, letter_times[hits[0]][0])
        end = min(duration, letter_times[hits[-1]][1] + 0.15)
        cues.append({'text': line, 'start': start, 'end': max(start + 0.02, end), 'review': share < CONFIDENT_LINE_MATCH})
    coverage = placed_letters / len(expected)
    index = 0
    while index < len(cues):
        if cues[index] is not None:
            index += 1
            continue
        first = index
        while index < len(cues) and cues[index] is None:
            index += 1
        left = float(cues[first - 1]['end']) if first else 0
        right = float(cues[index]['start']) if index < len(cues) else duration
        weights = [max(1, spans[i][1] - spans[i][0]) for i in range(first, index)]
        total = sum(weights)
        cursor = left
        for position, weight in zip(range(first, index), weights):
            # Share the gap by word count, but don't stretch a line across silence.
            length = min((right - left) * weight / total, weight * MAX_ESTIMATED_SECONDS_PER_WORD + 1)
            cues[position] = {'text': lines[position], 'start': cursor, 'end': cursor + length, 'review': True}
            cursor += (right - left) * weight / total
    result = fit_cues_in_order([cue for cue in cues if cue is not None], duration)
    return repair_impossible_timing(result), coverage


def repair_impossible_timing(cues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Speech recognition sometimes squashes repeated lines into an instant, or stretches one
    across a long instrumental. No singer does either, so share such stretches out evenly."""
    letters = [max(1, len(normalize_word(cue['text']))) for cue in cues]
    for cue, count in zip(cues, letters):
        longest = count * MAX_SECONDS_PER_LETTER + 1
        if cue['end'] - cue['start'] > longest:
            cue['end'] = round(cue['start'] + longest, 3)
            cue['review'] = True
    too_fast = [cue['end'] - cue['start'] < count * MIN_SECONDS_PER_LETTER for cue, count in zip(cues, letters)]
    index = 0
    while index < len(cues):
        if not too_fast[index]:
            index += 1
            continue
        first = max(0, index - 1)
        while index + 1 < len(cues) and (too_fast[index + 1] or (index + 2 < len(cues) and too_fast[index + 2])):
            index += 1
        last = min(len(cues) - 1, index + 1)
        start, end = cues[first]['start'], cues[last]['end']
        total = sum(letters[first:last + 1])
        cursor = start
        for position in range(first, last + 1):
            length = (end - start) * letters[position] / total
            cues[position].update(start=round(cursor, 3), end=round(cursor + length, 3), review=True)
            cursor += length
        index = last + 1
    return cues


def fit_cues_in_order(cues: list[dict[str, Any]], duration: float) -> list[dict[str, Any]]:
    """Resolve overlaps and zero-length lines, so uncertain timing is flagged rather than fatal."""
    for cue, following in zip(cues, cues[1:]):
        if following['start'] > cue['start']:
            cue['end'] = min(cue['end'], following['start'])
    previous_end = 0.0
    for cue in cues:
        cue['start'] = max(cue['start'], previous_end)
        if cue['end'] < cue['start'] + MIN_CUE_SECONDS:
            cue['end'] = cue['start'] + MIN_CUE_SECONDS
            cue['review'] = True
        previous_end = cue['end']
    next_start = duration
    for cue in reversed(cues):
        cue['end'] = min(cue['end'], next_start)
        cue['start'] = min(cue['start'], cue['end'] - MIN_CUE_SECONDS)
        next_start = cue['start']
    if cues and cues[0]['start'] < 0:
        share = duration / len(cues)
        for index, cue in enumerate(cues):
            cue.update(start=index * share, end=(index + 1) * share, review=True)
    for cue in cues:
        cue['start'], cue['end'] = round(cue['start'], 3), round(cue['end'], 3)
    return cues


def sync_lyrics(audio: Path, lines: list[str], duration: float, language: str | None, on_progress: Callable[..., None], should_cancel: Callable[[], bool] = lambda: False) -> tuple[list[dict[str, Any]], float]:
    on_progress(progress=0, phase='Waiting for the local sync engine')
    with _sync_lock:
        backend = Path(__file__).resolve().parents[2]
        args = [sys.executable, '-m', 'app.services.lyric_transcription_worker', str(audio.resolve()), settings.lyric_sync_model, str((settings.model_cache_dir / 'whisper').resolve()), language or '']
        with tempfile.TemporaryFile(mode='w+') as errors:
            process = subprocess.Popen(args, cwd=backend, stdout=subprocess.PIPE, stderr=errors, text=True)
            stop_process_when(process, should_cancel)
            words = []
            error = None
            try:
                assert process.stdout is not None
                for line in process.stdout:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if 'progress' in event:
                        on_progress(progress=event['progress'], phase=event.get('phase'))
                    if 'words' in event:
                        words = event['words']
                    if 'error' in event:
                        error = event['error']
                code = process.wait()
                if should_cancel():
                    raise JobCancelled()
                if code != 0:
                    errors.seek(0)
                    raise ValueError(error or ('Local transcription failed. ' + errors.read()[-1000:]))
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                if process.stdout is not None:
                    process.stdout.close()
        on_progress(progress=95, phase='Matching your lyric lines')
        return align_lyric_lines(lines, words, duration)
