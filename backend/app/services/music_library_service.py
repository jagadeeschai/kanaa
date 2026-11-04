"""The person's own music, from the Music app's folder on this Mac, sorted into moods for themes and the Audio tab.

Files there are only read. Their tags (title, artist, genre) and names say what each one is; bought packs often call
every track "Track", so the genre and file name carry the mood. Sound effects (under 30 seconds) and talks (podcasts,
or over 15 minutes) are left out. A track is copied into Kanaa's own song store only when it is used in a video, the
same as an uploaded song, so a project keeps working if the library changes.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from app.core.config import settings

AUDIO = {'.mp3', '.m4a', '.aac', '.wav', '.aif', '.aiff', '.flac', '.ogg'}
MIN_SECONDS, MAX_SECONDS = 30, 15 * 60
READERS = 8
TALK = re.compile(r'podcast|interview|playbook|framework|module|lecture|lesson', re.I)
TAMIL = re.compile(r'[஀-௿]')
MOODS = ('romantic', 'happy', 'birthday', 'calm', 'energetic', 'cinematic', 'inspiring', 'songs')
# Words in a name say the most; the genre tag is the fallback. First match wins.
NAME_WORDS = [
    ('birthday', r'birthday|bday'),
    ('happy', r'happy|fun\b|sunny|buddy|party|dance|punky|jazzy|you like it|pop\b'),
    ('romantic', r'love|romantic|wedding|acoustic|piano|beautiful|chill|breeze|gentle'),
    ('calm', r'memor|mindful|wind\b|winter|rain|ambient|dawn|sunrise|fallen|soul|calm|relax'),
    ('cinematic', r'cinematic|epic|legend|final|movie|pirate|sapphire|criminal|west|dark|trailer'),
    ('energetic', r'action|extreme|rock|electro|modern|motion|progressive|high times|sport|power'),
    ('inspiring', r'uplift|inspir|corporate|success|career|creative|idea|office|touring|prism|lounge|bright'),
]
GENRES = {
    'romantic': {'classical', 'easy listening', 'jazz', 'lounge', 'country'},
    'calm': {'ambient', 'minimalism', 'atmospheric', 'new age'},
    'happy': {'disco', 'dance', 'pop', 'children'},
    'energetic': {'electronic', 'electronica', 'video game', 'experimental', 'rock', 'hip-hop', 'hip hop'},
    'cinematic': {'soundtrack', 'cinematic', 'score', 'unclassifiable'},
    'inspiring': {'contemporary', 'success', 'rhytmic soul', 'rhythmic soul', 'corporate'},
}
_lock = threading.Lock()


def library_root() -> Path:
    """The Music app's media folder, or KANAA_MUSIC_DIR."""
    chosen = os.getenv('KANAA_MUSIC_DIR')
    if chosen:
        return Path(chosen).expanduser()
    base = Path.home() / 'Music' / 'Music'
    for name in ('Media.localized/Music', 'Media/Music', 'Media.localized', 'Media'):
        if (base / name).is_dir():
            return base / name
    return base


def mood_of(name: str, genre: Optional[str]) -> str:
    if TAMIL.search(name):
        return 'songs'
    for mood, words in NAME_WORDS:
        if re.search(words, name, re.I):
            return mood
    lowered = (genre or '').strip().lower()
    for mood, genres in GENRES.items():
        if lowered in genres:
            return mood
    return 'cinematic'


def read_tags(path: Path) -> Optional[dict]:
    result = subprocess.run([shutil.which('ffprobe') or 'ffprobe', '-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', str(path)],
                            capture_output=True, text=True, timeout=30)
    try:
        found = json.loads(result.stdout or '{}').get('format', {})
        seconds = float(found.get('duration', 0))
    except (ValueError, TypeError):
        return None
    tags = {key.lower(): str(value).strip() for key, value in found.get('tags', {}).items()}
    return {'seconds': seconds, 'title': tags.get('title') or None, 'artist': tags.get('artist') or None, 'genre': tags.get('genre') or None}


def describe(path: Path, tags: dict) -> Optional[dict]:
    seconds = tags['seconds']
    stem = path.stem
    if not MIN_SECONDS <= seconds <= MAX_SECONDS or TALK.search(stem) or TALK.search(tags.get('title') or ''):
        return None
    title = tags.get('title')
    # Packs that call everything "Track" are named by their file: Track 12.
    name = title if title and title.lower() not in ('track', 'untitled', 'unknown') else stem
    name = re.sub(r'^\d+\s+', '', name).strip('_ ').strip() or stem
    return {'id': hashlib.sha256(str(path).encode()).hexdigest()[:16], 'name': name[:120], 'artist': tags.get('artist'), 'genre': tags.get('genre'),
            'seconds': round(seconds, 2), 'mood': mood_of(f'{name} {stem}', tags.get('genre'))}


def index_path() -> Path:
    return settings.data_dir / 'music-library-2.json'


def tracks() -> list[dict]:
    """Every usable track, its tags read once and kept until the file changes."""
    root = library_root()
    with _lock:
        try:
            saved = json.loads(index_path().read_text())
        except (OSError, ValueError):
            saved = {}
        known, listed = {}, []
        files = [path for path in sorted(root.rglob('*')) if path.suffix.lower() in AUDIO and path.is_file() and not path.name.startswith('.')] if root.is_dir() else []
        stamps = {path: f'{path.stat().st_size}:{int(path.stat().st_mtime)}' for path in files}
        fresh = [path for path in files if (saved.get(str(path)) or {}).get('stamp') != stamps[path]]
        # New or changed files are read several at a time: a first look at a big library takes seconds, not minutes.
        with ThreadPoolExecutor(max_workers=READERS) as pool:
            read = dict(zip(fresh, pool.map(read_tags, fresh)))
        for path in files:
            # Only the tags are kept, so the moods follow any change to how they are worked out.
            entry = saved.get(str(path)) if path not in read else {'stamp': stamps[path], 'tags': read[path]}
            known[str(path)] = entry
            track = describe(path, entry['tags']) if entry.get('tags') else None
            if track:
                listed.append(track)
        if known != saved:
            index_path().parent.mkdir(parents=True, exist_ok=True)
            temporary = index_path().with_suffix('.tmp')
            temporary.write_text(json.dumps(known))
            temporary.replace(index_path())
    # The same song kept twice (the Music app does that) shows once.
    seen, unique = set(), []
    for track in listed:
        same = (track['name'].lower(), round(track['seconds']))
        if same not in seen:
            seen.add(same)
            unique.append(track)
    return sorted(unique, key=lambda track: (MOODS.index(track['mood']), track['name'].lower()))


def path_of(track_id: str) -> Path:
    """The library file for an id, only if it is still a listed track."""
    if not re.fullmatch(r'[0-9a-f]{16}', track_id):
        raise ValueError('Unknown track.')
    try:
        saved = json.loads(index_path().read_text())
    except (OSError, ValueError):
        saved = {}
    for path, entry in saved.items():
        if entry.get('tags') and hashlib.sha256(path.encode()).hexdigest()[:16] == track_id and describe(Path(path), entry['tags']) and Path(path).is_file():
            return Path(path)
    raise ValueError('That track is no longer in your music library.')


def use(track_id: str) -> dict:
    """Copies the track into Kanaa's song store, once, and returns it as an uploaded song."""
    source = path_of(track_id)
    track = next((item for item in tracks() if item['id'] == track_id), None)
    if track is None:
        raise ValueError('That track is no longer in your music library.')
    asset_id = hashlib.sha256(f'library:{source}:{source.stat().st_size}'.encode()).hexdigest()[:32]
    target = settings.data_dir / 'video_audio' / asset_id
    if not target.is_file():
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        shutil.copyfile(source, temporary)
        temporary.replace(target)
    return {'asset_id': asset_id, 'duration': track['seconds'], 'name': track['name']}
