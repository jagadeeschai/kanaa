"""Bring to life: a picture on the timeline made into a few seconds of video by an image-to-video API.

Providers differ, so each style of API is a small adapter with the same two steps, submit and wait:
- 'atlas':  POST {base}/model/generateVideo, then GET {base}/model/prediction/{id} until its outputs are ready
            (Atlas Cloud, and gateways that copy its shape). Any of its video models: Wan, Kling, Seedance...
- 'openai': POST {base}/videos (multipart, input_reference), GET {base}/videos/{id}, GET {base}/videos/{id}/content.
Settings live in video-ai-settings.json in Kanaa's data folder; the key never leaves the backend and is never shown.
The result is a new video beside the picture: the picture itself is never changed. No sound is asked for: the song
is the soundtrack.
"""
import base64
import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.core.config import settings
from app.services.job_service import JobCancelled, update_job
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render

PROVIDERS = ('atlas', 'openai')
DEFAULTS = {'provider': 'atlas', 'base_url': 'https://api.atlascloud.ai/api/v1', 'model': 'alibaba/wan-2.6/image-to-video-flash', 'resolution': '720p'}
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
POLL_SECONDS = 4
GIVE_UP_SECONDS = 20 * 60
SECONDS = (5, 15)  # What the cheap models accept; a longer clip plays the video slower.


def _path():
    return settings.data_dir / 'video-ai-settings.json'


def read_settings() -> dict:
    stored = json.loads(_path().read_text()) if _path().exists() else {}
    return {**DEFAULTS, **{k: v for k, v in stored.items() if k in DEFAULTS}, 'api_key': os.getenv('KANAA_VIDEO_API_KEY') or stored.get('api_key', '')}


def public_settings() -> dict:
    config = read_settings()
    return {**{k: config[k] for k in DEFAULTS}, 'configured': bool(config['api_key']),
            'key_source': 'environment' if os.getenv('KANAA_VIDEO_API_KEY') else 'local' if config['api_key'] else None}


def save_settings(provider: str, base_url: str, model: str, resolution: str, api_key: str | None = None, clear_key: bool = False) -> dict:
    url = urlsplit(base_url.strip().rstrip('/'))
    if (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in LOCAL_HOSTS)) or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Use an HTTPS API URL, or a local HTTP provider.')
    if provider not in PROVIDERS:
        raise ValueError('Choose a provider style: atlas or openai.')
    if not model.strip():
        raise ValueError('Enter a video model.')
    current = json.loads(_path().read_text()) if _path().exists() else {}
    key = '' if clear_key else api_key.strip() if api_key else current.get('api_key', '')
    config = {'provider': provider, 'base_url': base_url.strip().rstrip('/'), 'model': model.strip(), 'resolution': resolution, 'api_key': key}
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.video-ai-settings-', dir=settings.data_dir)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(config, output)
        os.replace(temporary, _path())
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return public_settings()


def instruction(prompt: str) -> str:
    return ('Animate this exact picture as one continuous shot. Keep its people, place, colours and framing; '
            f'only add gentle, natural motion. {prompt.strip()}')


def _fail_on(response: httpx.Response, step: str):
    if response.status_code in (401, 403):
        raise ValueError('The video provider rejected the key. Check it in AI settings → Video.')
    if response.status_code == 402:
        raise ValueError('The video provider says the balance is used up. Add credit, then try again.')
    if response.status_code == 429:
        raise ValueError('The video provider is busy or the limit was reached. Wait a little and try again.')
    if response.status_code >= 400:
        detail = response.text[:200].replace('\n', ' ')
        raise ValueError(f'The video provider could not {step} (HTTP {response.status_code}): {detail}')


def _wait(should_cancel, job_id, check):
    """Calls check() every few seconds until it returns something; stops when cancelled or after GIVE_UP_SECONDS."""
    began = time.monotonic()
    while True:
        if should_cancel():
            raise JobCancelled()
        found = check()
        if found is not None:
            return found
        waited = time.monotonic() - began
        if waited > GIVE_UP_SECONDS:
            raise ValueError('The video provider took too long. Your credit may have been used; check its dashboard.')
        update_job(job_id, phase=f'The AI is making the video… {int(waited)} s', progress=min(90, 15 + int(waited / 3)))
        for _ in range(POLL_SECONDS * 4):
            if should_cancel():
                raise JobCancelled()
            time.sleep(0.25)


def _atlas(client, config, picture: bytes, mime: str, prompt: str, seconds: int, should_cancel, job_id) -> bytes:
    body = {'model': config['model'], 'image': f'data:{mime};base64,' + base64.b64encode(picture).decode(), 'prompt': instruction(prompt),
            'resolution': config['resolution'], 'duration': seconds, 'generate_audio': False, 'shot_type': 'single'}
    response = client.post(config['base_url'] + '/model/generateVideo', json=body)
    _fail_on(response, 'start the video')
    prediction = (response.json().get('data') or {}).get('id')
    if not prediction:
        raise ValueError('The video provider did not return a job id.')

    def check():
        polled = client.get(config['base_url'] + f'/model/prediction/{prediction}')
        _fail_on(polled, 'report on the video')
        data = polled.json().get('data') or polled.json()
        status = str(data.get('status', '')).lower()
        if status in ('failed', 'error', 'cancelled', 'canceled'):
            raise ValueError(f"The video provider could not make this video: {data.get('error') or status}.")
        outputs = data.get('outputs') or []
        return outputs[0] if status in ('completed', 'succeeded', 'success') and outputs else None
    address = _wait(should_cancel, job_id, check)
    downloaded = client.get(address)
    _fail_on(downloaded, 'hand over the video')
    return downloaded.content


def _openai(client, config, picture: bytes, mime: str, prompt: str, seconds: int, should_cancel, job_id) -> bytes:
    files = {'input_reference': ('picture' + ('.png' if mime == 'image/png' else '.jpg'), picture, mime)}
    response = client.post(config['base_url'] + '/videos', data={'model': config['model'], 'prompt': instruction(prompt), 'seconds': str(seconds)}, files=files)
    _fail_on(response, 'start the video')
    video = response.json().get('id')
    if not video:
        raise ValueError('The video provider did not return a job id.')

    def check():
        polled = client.get(config['base_url'] + f'/videos/{video}')
        _fail_on(polled, 'report on the video')
        status = str(polled.json().get('status', '')).lower()
        if status in ('failed', 'error', 'cancelled'):
            raise ValueError('The video provider could not make this video.')
        return True if status == 'completed' else None
    _wait(should_cancel, job_id, check)
    downloaded = client.get(config['base_url'] + f'/videos/{video}/content')
    _fail_on(downloaded, 'hand over the video')
    return downloaded.content


ADAPTERS = {'atlas': _atlas, 'openai': _openai}


def start(media_id: int, prompt: str, seconds: int = 5) -> str:
    if not prompt.strip():
        raise ValueError('Say how it should move first.')
    item = dict(get_media(media_id))
    if item['media_type'] != 'image':
        raise ValueError('Bring to life works on pictures.')
    config = read_settings()
    if not config['api_key']:
        raise ValueError('Add a video API key in AI settings → Video first.')
    seconds = max(SECONDS[0], min(SECONDS[1], int(seconds)))
    source = Path(item['absolute_path'])
    name = Path(item.get('filename') or 'picture').stem[:60]

    def run(should_cancel):
        update_job(job_id, phase='Sending the picture to the video AI', progress=5)
        from PIL import Image
        import io
        buffer = io.BytesIO()
        with Image.open(source) as image:  # One plain JPEG whatever it was, at most 2048 px: small to send, any provider takes it.
            picture = image.convert('RGB')
            picture.thumbnail((2048, 2048))
            picture.save(buffer, 'JPEG', quality=92)
        target = settings.data_dir / 'media' / f'ai-video-{uuid.uuid4().hex}.mp4'
        try:
            with httpx.Client(timeout=httpx.Timeout(300, connect=20), headers={'Authorization': 'Bearer ' + config['api_key']}, follow_redirects=True) as client:
                video = ADAPTERS[config['provider']](client, config, buffer.getvalue(), 'image/jpeg', prompt, seconds, should_cancel, job_id)
            if should_cancel():
                raise JobCancelled()
            if len(video) < 1000:
                raise ValueError('The video provider sent back an empty video.')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(video)
            media = index_media(target, f'{name} (AI motion).mp4', folder=item.get('folder'))
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return {'progress': 100, 'media_id': media['id']}

    job_id = enqueue_render('ai_video', f'Bring to life · {name}', run, total=100)
    return job_id
