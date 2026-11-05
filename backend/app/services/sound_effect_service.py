"""Whooshes and hits for transitions and title reveals.

They come from the short sound effects in the person's music library (named whoosh, swoosh, swish, hit, impact, boom…,
under 30 seconds, which the music list leaves out), or from Kanaa's own two, made here in code. Each is copied into
Kanaa's song store like any song, with the moment it is loudest, so it can be placed to peak exactly on a cut.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

from app.core.config import settings
from app.services import music_library_service

RATE = 44100
MAX_SECONDS = 30.0
KINDS = {'whoosh': re.compile(r'whoosh|woosh|swoosh|swish|swipe|whip|sweep|riser|transition', re.I),
         'hit': re.compile(r'\bhit|impact|boom|thud|punch|slam|drum ?hit|braam|stinger', re.I)}
OWN = {'kanaa-whoosh': ('whoosh', "Kanaa's whoosh"), 'kanaa-hit': ('hit', "Kanaa's hit")}
VERSION = 1


def _store(asset_id: str) -> Path:
    return settings.data_dir / 'video_audio' / asset_id


def _write_wav(path: Path, samples: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    temporary = path.with_suffix('.tmp')
    with wave.open(str(temporary), 'wb') as output:
        output.setnchannels(2); output.setsampwidth(2); output.setframerate(RATE)
        output.writeframes(np.repeat(data[:, None], 2, axis=1).tobytes())
    temporary.replace(path)


def make_whoosh(seconds: float = 0.9, peak: float = 0.5) -> np.ndarray:
    """Air rushing past: noise through a filter that sweeps up then down, swelling to `peak` and falling away."""
    rng = np.random.default_rng(7)
    count = int(seconds * RATE)
    t = np.arange(count) / RATE
    noise = rng.standard_normal(count)
    # A one-pole low-pass whose cut-off rises to the peak and falls after it: the "whoo" then the "sh".
    cutoff = 300 + 5200 * np.exp(-((t - peak) / 0.18) ** 2)
    alpha = 1 - np.exp(-2 * np.pi * cutoff / RATE)
    out = np.empty(count)
    state = 0.0
    for index in range(count):
        state += alpha[index] * (noise[index] - state)
        out[index] = state
    envelope = np.where(t < peak, (t / peak) ** 2.2, np.exp(-(t - peak) / 0.12))
    out *= envelope
    return out / (np.abs(out).max() or 1) * 0.8


def make_hit(seconds: float = 0.8) -> np.ndarray:
    """A deep cinematic thump: a falling low tone with a short bright click at the start."""
    rng = np.random.default_rng(11)
    count = int(seconds * RATE)
    t = np.arange(count) / RATE
    pitch = 45 + 70 * np.exp(-t / 0.05)
    body = np.sin(2 * np.pi * np.cumsum(pitch) / RATE) * np.exp(-t / 0.22)
    click = rng.standard_normal(count) * np.exp(-t / 0.008) * 0.35
    out = body + click
    return out / (np.abs(out).max() or 1) * 0.9


def loudest(path: Path) -> float:
    """Seconds into the file where it is loudest: where a whoosh should meet the cut."""
    result = subprocess.run([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-t', str(MAX_SECONDS), '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
                            capture_output=True, timeout=60)
    samples = np.abs(np.frombuffer(result.stdout, '<i2').astype(np.float32))
    if not len(samples):
        return 0.0
    window = 400  # 50 ms
    energy = np.convolve(samples, np.ones(window) / window, mode='same')
    return round(float(np.argmax(energy)) / 8000, 3)


def library_effects() -> list[dict]:
    """Short effects in the music library that sound like whooshes or hits, by their names."""
    music_library_service.tracks()  # Brings the library's index up to date.
    try:
        saved = json.loads(music_library_service.index_path().read_text())
    except (OSError, ValueError):
        return []
    found = []
    for path, entry in saved.items():
        tags = entry.get('tags') or {}
        seconds = float(tags.get('seconds') or 0)
        if not 0.1 <= seconds < MAX_SECONDS or not Path(path).is_file():
            continue
        name = f"{Path(path).stem} {tags.get('title') or ''}"
        kind = next((kind for kind, pattern in KINDS.items() if pattern.search(name)), None)
        if kind:
            label = re.sub(r'^\d+\s+', '', (tags.get('title') or Path(path).stem)).strip()[:80]
            found.append({'id': hashlib.sha256(path.encode()).hexdigest()[:16], 'kind': kind, 'name': label, 'seconds': round(seconds, 2), 'path': path})
    return sorted(found, key=lambda item: (item['kind'], item['name'].lower()))


def effects() -> list[dict]:
    own = [{'id': key, 'kind': kind, 'name': name, 'seconds': 0.9 if kind == 'whoosh' else 0.8, 'own': True} for key, (kind, name) in OWN.items()]
    return own + [{key: value for key, value in item.items() if key != 'path'} for item in library_effects()]


def use(effect_id: str) -> dict:
    """The effect as a song in Kanaa's store: {asset_id, duration, name, kind, peak}."""
    if effect_id in OWN:
        kind, name = OWN[effect_id]
        asset_id = hashlib.sha256(f'{effect_id}-v{VERSION}'.encode()).hexdigest()[:32]
        target = _store(asset_id)
        if not target.is_file():
            _write_wav(target, make_whoosh() if kind == 'whoosh' else make_hit())
        return {'asset_id': asset_id, 'duration': 0.9 if kind == 'whoosh' else 0.8, 'name': name, 'kind': kind, 'peak': 0.5 if kind == 'whoosh' else 0.0}
    item = next((entry for entry in library_effects() if entry['id'] == effect_id), None)
    if item is None:
        raise ValueError('That sound effect is no longer in your music library.')
    source = Path(item['path'])
    asset_id = hashlib.sha256(f'library:{source}:{source.stat().st_size}'.encode()).hexdigest()[:32]
    target = _store(asset_id)
    if not target.is_file():
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        shutil.copyfile(source, temporary)  # The library file is only read.
        temporary.replace(target)
    return {'asset_id': asset_id, 'duration': item['seconds'], 'name': item['name'], 'kind': item['kind'], 'peak': loudest(target)}
