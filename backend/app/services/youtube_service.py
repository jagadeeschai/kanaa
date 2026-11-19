"""Publish to YouTube from Kanaa: sign in once with Google (the owner's own Google Cloud desktop client), then upload an
export with its title, description, privacy, thumbnail, lyric captions and playlist in one go.

Secrets: the sign-in (refresh token) lives in the Mac's Keychain, never in a file, a project or a response. The OAuth
client (id and secret of a Google "desktop app" client, which Google treats as not secret) sits in the data folder.
Uploads are resumable: a dropped connection carries on from the last byte YouTube confirmed."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

import httpx
from PIL import Image, ImageOps

from app.core.config import settings

AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
API = 'https://www.googleapis.com/youtube/v3'
UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3'
# Upload, plus captions, thumbnails and playlists (force-ssl covers managing the channel's videos).
SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl'
KEYCHAIN_SERVICE = 'kanaa.youtube'
KEYCHAIN_ACCOUNT = 'kanaa'
CHUNK = 8 * 1024 * 1024  # A multiple of 256 KiB, as resumable uploads require.
SIGN_IN_SECONDS = 600
RETRIES = 6
PRIVACY = ('private', 'unlisted', 'public')
CATEGORIES = {'music': '10', 'film': '1', 'people': '22', 'entertainment': '24', 'education': '27', 'travel': '19'}

_pending: dict[str, tuple[str, str, float]] = {}  # state -> (code verifier, redirect address, started)
_access: dict[str, Any] = {}
_lock = threading.Lock()


class YouTubeError(Exception):
    """Something the person can act on, in plain words."""


# --- Keychain -------------------------------------------------------------------------------------------------------
# Tests replace these three; the token never reaches argv (it goes through `security -i` on stdin, base64-encoded).

def keychain_read() -> dict | None:
    result = subprocess.run(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'], capture_output=True, text=True)
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        return json.loads(base64.b64decode(result.stdout.strip()))
    except ValueError:
        return None


def keychain_write(value: dict) -> None:
    encoded = base64.b64encode(json.dumps(value).encode()).decode()
    command = f'add-generic-password -U -s {KEYCHAIN_SERVICE} -a {KEYCHAIN_ACCOUNT} -l "Kanaa YouTube sign-in" -w {encoded}\n'
    result = subprocess.run(['security', '-i'], input=command, capture_output=True, text=True)
    if result.returncode != 0:
        raise YouTubeError('Could not save the YouTube sign-in to the Keychain.')


def keychain_delete() -> None:
    subprocess.run(['security', 'delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT], capture_output=True)


# --- Settings files -------------------------------------------------------------------------------------------------

def _path(name: str) -> Path:
    return settings.data_dir / name


def _read(name: str) -> dict:
    path = _path(name)
    try:
        return json.loads(path.read_text()) if path.exists() else {}
    except ValueError:
        return {}


def _write(name: str, value: dict | None) -> None:
    path = _path(name)
    if value is None:
        path.unlink(missing_ok=True)
        return
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{name}-', dir=settings.data_dir)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(value, output)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def client() -> dict:
    return _read('youtube-client.json')


def save_client(text: str) -> dict:
    """Takes the client JSON Google downloads (client_secret_….json), or {"client_id", "client_secret"}."""
    try:
        data = json.loads(text)
    except ValueError:
        raise YouTubeError('That is not the file Google gave you. Download the JSON for a “Desktop app” client.') from None
    if isinstance(data, dict) and isinstance(data.get('installed'), dict):
        data = data['installed']
    elif isinstance(data, dict) and isinstance(data.get('web'), dict):
        raise YouTubeError('That client is a “Web application”. Create one of type “Desktop app” instead.')
    if not isinstance(data, dict):
        raise YouTubeError('That is not the file Google gave you. Download the JSON for a “Desktop app” client.')
    client_id, client_secret = str(data.get('client_id', '')).strip(), str(data.get('client_secret', '')).strip()
    if not client_id.endswith('.apps.googleusercontent.com') or not client_secret:
        raise YouTubeError('The file needs a client ID and secret from Google Cloud (Credentials › OAuth client › Desktop app).')
    if client_id != client().get('client_id'):
        disconnect()  # A sign-in belongs to the client that made it.
    _write('youtube-client.json', {'client_id': client_id, 'client_secret': client_secret})
    return status()


def status() -> dict:
    account = _read('youtube-account.json')
    connected = bool(account) and keychain_read() is not None
    return {'client': bool(client().get('client_id')), 'connected': connected,
            'channel': account.get('channel') if connected else None, 'channel_id': account.get('channel_id') if connected else None}


# --- Sign-in --------------------------------------------------------------------------------------------------------

def sign_in_address(redirect: str) -> str:
    """The Google page to open in the browser. redirect is this server's callback (a 127.0.0.1 loopback address)."""
    config = client()
    if not config.get('client_id'):
        raise YouTubeError('Add your Google client first.')
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    state = secrets.token_urlsafe(24)
    with _lock:
        now = time.time()
        for key in [key for key, (_, _, started) in _pending.items() if now - started > SIGN_IN_SECONDS]:
            del _pending[key]
        _pending[state] = (verifier, redirect, now)
    return AUTH_URL + '?' + urlencode({'client_id': config['client_id'], 'redirect_uri': redirect, 'response_type': 'code', 'scope': SCOPES,
                                       'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256',
                                       'access_type': 'offline', 'prompt': 'consent'})


def finish_sign_in(state: str, code: str, http: httpx.Client | None = None) -> dict:
    with _lock:
        pending = _pending.pop(state, None)
    if not pending or time.time() - pending[2] > SIGN_IN_SECONDS:
        raise YouTubeError('This sign-in link has expired. Click Connect YouTube in Kanaa again.')
    verifier, redirect, _ = pending
    config = client()
    with (http or httpx.Client(timeout=30)) as session:
        response = session.post(TOKEN_URL, data={'client_id': config['client_id'], 'client_secret': config['client_secret'], 'code': code,
                                                'code_verifier': verifier, 'grant_type': 'authorization_code', 'redirect_uri': redirect})
        if response.status_code != 200:
            raise YouTubeError('Google did not accept the sign-in. Try Connect YouTube again.')
        tokens = response.json()
        if not tokens.get('refresh_token'):
            raise YouTubeError('Google did not give Kanaa lasting access. Try Connect YouTube again.')
        keychain_write({'refresh_token': tokens['refresh_token']})
        with _lock:
            _access.update(token=tokens.get('access_token'), until=time.time() + int(tokens.get('expires_in', 0)) - 60)
        channels = session.get(f'{API}/channels', params={'part': 'snippet', 'mine': 'true'}, headers={'Authorization': f'Bearer {tokens["access_token"]}'})
        items = channels.json().get('items', []) if channels.status_code == 200 else []
    if not items:
        keychain_delete()
        raise YouTubeError('This Google account has no YouTube channel. Create one on YouTube, then connect again.')
    _write('youtube-account.json', {'channel': items[0]['snippet']['title'], 'channel_id': items[0]['id']})
    return status()


def disconnect() -> dict:
    stored = keychain_read()
    if stored and stored.get('refresh_token'):
        try:
            httpx.post(REVOKE_URL, data={'token': stored['refresh_token']}, timeout=10)
        except httpx.HTTPError:
            pass  # Removing it here is what matters; Google drops unused grants anyway.
    keychain_delete()
    _write('youtube-account.json', None)
    with _lock:
        _access.clear()
    return status()


def access_token(http: httpx.Client) -> str:
    with _lock:
        if _access.get('token') and _access.get('until', 0) > time.time():
            return _access['token']
    stored, config = keychain_read(), client()
    if not stored or not config.get('client_id'):
        raise YouTubeError('Connect YouTube first.')
    response = http.post(TOKEN_URL, data={'client_id': config['client_id'], 'client_secret': config['client_secret'],
                                          'refresh_token': stored['refresh_token'], 'grant_type': 'refresh_token'})
    if response.status_code != 200:
        if response.status_code in (400, 401):
            raise YouTubeError('YouTube signed Kanaa out (the access was removed or expired). Connect YouTube again.')
        raise YouTubeError('Could not reach Google to sign in. Check the internet connection.')
    tokens = response.json()
    with _lock:
        _access.update(token=tokens['access_token'], until=time.time() + int(tokens.get('expires_in', 0)) - 60)
    return tokens['access_token']


# --- Thumbnail ------------------------------------------------------------------------------------------------------

THUMB_SIZE = (1280, 720)
THUMB_LIMIT = 2 * 1024 * 1024


def make_thumbnail(source: Path, target: Path, at: float | None = None, upright: bool = False) -> Path:
    """A YouTube thumbnail from a picture, or from the video's frame at `at` seconds: 1280×720 (720×1280 upright),
    filled edge to edge, as a JPEG under YouTube's 2 MB limit."""
    if at is not None:
        frame = target.with_suffix('.frame.png')
        made = subprocess.run([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', f'{max(0.0, at):.3f}', '-i', str(source),
                               '-frames:v', '1', str(frame)], capture_output=True)
        if made.returncode != 0 or not frame.exists():
            raise YouTubeError('Could not take that frame from the video.')
        source = frame
    size = THUMB_SIZE[::-1] if upright else THUMB_SIZE
    with Image.open(source) as picture:
        picture = ImageOps.fit(ImageOps.exif_transpose(picture).convert('RGB'), size, Image.LANCZOS)
        for quality in (92, 85, 75, 60):
            picture.save(target, 'JPEG', quality=quality, optimize=True)
            if target.stat().st_size <= THUMB_LIMIT:
                break
    if at is not None:
        source.unlink(missing_ok=True)
    return target


# --- Upload ---------------------------------------------------------------------------------------------------------

def video_body(meta: dict) -> dict:
    title = ' '.join(str(meta.get('title') or '').split())[:100] or 'Untitled'
    description = str(meta.get('description') or '').replace('<', '‹').replace('>', '›')[:5000]
    tags, total = [], 0
    for tag in meta.get('tags') or []:
        tag = ' '.join(str(tag).replace('<', '').replace('>', '').split())[:100]
        if tag and total + len(tag) + 1 <= 480:
            tags.append(tag); total += len(tag) + 1
    snippet = {'title': title.replace('<', '‹').replace('>', '›'), 'description': description, 'categoryId': CATEGORIES.get(meta.get('category') or 'music', '10')}
    if tags:
        snippet['tags'] = tags
    if meta.get('language'):
        snippet['defaultLanguage'] = snippet['defaultAudioLanguage'] = meta['language']
    privacy = meta.get('privacy') if meta.get('privacy') in PRIVACY else 'private'
    state = {'privacyStatus': privacy, 'selfDeclaredMadeForKids': bool(meta.get('made_for_kids')), 'embeddable': True}
    if meta.get('publish_at'):
        state['privacyStatus'] = 'private'  # YouTube publishes a scheduled video itself, at publishAt.
        state['publishAt'] = meta['publish_at']
    return {'snippet': snippet, 'status': state}


def _explain(response: httpx.Response) -> str:
    try:
        reason = response.json()['error']['errors'][0].get('reason', '')
    except (ValueError, KeyError, IndexError, TypeError):
        reason = ''
    return {'quotaExceeded': 'YouTube’s daily upload allowance for your Google project is used up. Try again tomorrow.',
            'uploadLimitExceeded': 'Your channel has reached YouTube’s upload limit for today.',
            'youtubeSignupRequired': 'This Google account has no YouTube channel yet.',
            'invalidPublishAt': 'Pick a publish time in the future.',
            'forbidden': 'YouTube refused this. Check the channel is in good standing in YouTube Studio.'}.get(
        reason, f'YouTube said no ({response.status_code}{": " + reason if reason else ""}).')


def _send(http: httpx.Client, method: str, url: str, **kwargs) -> httpx.Response:
    """One request with retries for network errors and YouTube's temporary 5xx answers."""
    for attempt in range(RETRIES):
        try:
            response = http.request(method, url, **kwargs)
        except httpx.TransportError:
            if attempt == RETRIES - 1:
                raise YouTubeError('Lost the internet connection while talking to YouTube.') from None
        else:
            if response.status_code < 500:
                return response
            if attempt == RETRIES - 1:
                return response
        time.sleep(min(30, 2 ** attempt))
    raise AssertionError('unreachable')


def upload_video(path: Path, meta: dict, progress: Callable[[float, str], None], should_cancel: Callable[[], bool],
                 http: httpx.Client | None = None, chunk: int = CHUNK) -> dict:
    """Uploads path with meta (title, description, tags, category, language, privacy, publish_at, made_for_kids,
    captions [{language, name, srt}], thumbnail (a picture path), playlist_id). Returns the video's id and links."""
    size = path.stat().st_size
    if size == 0:
        raise YouTubeError('That video file is empty.')
    owned = http is None
    http = http or httpx.Client(timeout=httpx.Timeout(60, write=300))
    try:
        auth = lambda: {'Authorization': f'Bearer {access_token(http)}'}  # noqa: E731 — fresh each call, tokens expire in an hour.
        progress(0, 'Starting the upload')
        start = _send(http, 'POST', f'{UPLOAD_API}/videos', params={'uploadType': 'resumable', 'part': 'snippet,status'},
                      headers={**auth(), 'X-Upload-Content-Length': str(size), 'X-Upload-Content-Type': 'video/mp4', 'Content-Type': 'application/json; charset=UTF-8'},
                      content=json.dumps(video_body(meta)).encode())
        if start.status_code != 200 or 'location' not in start.headers:
            raise YouTubeError(_explain(start))
        session_url, sent, video = start.headers['location'], 0, None
        with path.open('rb') as source:
            while video is None:
                if should_cancel():
                    _send(http, 'DELETE', session_url, headers=auth())
                    raise YouTubeError('Upload cancelled.')
                source.seek(sent)
                data = source.read(chunk)
                end = sent + len(data) - 1
                try:
                    response = http.put(session_url, content=data, headers={**auth(), 'Content-Length': str(len(data)), 'Content-Range': f'bytes {sent}-{end}/{size}'})
                except httpx.TransportError:
                    response = None
                if response is not None and response.status_code in (200, 201):
                    video = response.json()
                    break
                if response is not None and response.status_code not in (308,) and response.status_code < 500:
                    if response.status_code == 404:
                        raise YouTubeError('YouTube dropped the upload after a long break. Publish again.')
                    raise YouTubeError(_explain(response))
                if response is None or response.status_code >= 500:
                    # Ask YouTube how much it has, then carry on from there.
                    time.sleep(2)
                    response = _send(http, 'PUT', session_url, headers={**auth(), 'Content-Range': f'bytes */{size}', 'Content-Length': '0'})
                    if response.status_code in (200, 201):
                        video = response.json()
                        break
                    if response.status_code != 308:
                        raise YouTubeError(_explain(response))
                confirmed = response.headers.get('range')
                sent = int(confirmed.rsplit('-', 1)[1]) + 1 if confirmed else 0
                progress(sent / size * 90, 'Uploading to YouTube')
        video_id = video['id']
        notes: list[str] = []
        if meta.get('thumbnail'):
            progress(92, 'Adding the thumbnail')
            picture = Path(meta['thumbnail'])
            kind = 'image/png' if picture.suffix.lower() == '.png' else 'image/jpeg'
            response = _send(http, 'POST', f'{UPLOAD_API}/thumbnails/set', params={'videoId': video_id}, headers={**auth(), 'Content-Type': kind}, content=picture.read_bytes())
            if response.status_code != 200:
                notes.append('The thumbnail was not added: custom thumbnails need a verified channel (youtube.com/verify).'
                             if response.status_code == 403 else 'The thumbnail was not added.')
        for caption in meta.get('captions') or []:
            progress(95, 'Adding the captions')
            boundary = secrets.token_hex(12)
            body = (f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
                    + json.dumps({'snippet': {'videoId': video_id, 'language': caption['language'], 'name': caption.get('name', ''), 'isDraft': False}})
                    + f'\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n' + caption['srt'] + f'\r\n--{boundary}--\r\n').encode()
            response = _send(http, 'POST', f'{UPLOAD_API}/captions', params={'uploadType': 'multipart', 'part': 'snippet'},
                             headers={**auth(), 'Content-Type': f'multipart/related; boundary={boundary}'}, content=body)
            if response.status_code != 200:
                notes.append(f'The {caption.get("name") or caption["language"]} captions were not added.')
        if meta.get('playlist_id'):
            progress(98, 'Adding it to the playlist')
            response = _send(http, 'POST', f'{API}/playlistItems', params={'part': 'snippet'}, headers={**auth(), 'Content-Type': 'application/json'},
                             content=json.dumps({'snippet': {'playlistId': meta['playlist_id'], 'resourceId': {'kind': 'youtube#video', 'videoId': video_id}}}).encode())
            if response.status_code != 200:
                notes.append('It was not added to the playlist.')
        progress(100, 'On YouTube')
        return {'youtube_id': video_id, 'youtube_url': f'https://youtu.be/{video_id}', 'studio_url': f'https://studio.youtube.com/video/{video_id}/edit',
                'privacy': video.get('status', {}).get('privacyStatus'), 'notes': notes}
    finally:
        if owned:
            http.close()


def playlists(http: httpx.Client | None = None) -> list[dict]:
    with (http or httpx.Client(timeout=30)) as session:
        response = _send(session, 'GET', f'{API}/playlists', params={'part': 'snippet', 'mine': 'true', 'maxResults': 50}, headers={'Authorization': f'Bearer {access_token(session)}'})
        if response.status_code != 200:
            raise YouTubeError(_explain(response))
        return [{'id': item['id'], 'title': item['snippet']['title']} for item in response.json().get('items', [])]
