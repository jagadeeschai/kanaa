"""A new picture drawn with earlier pictures as references, so the same people and place carry on: the provider's
image edit request (OpenAI-compatible /images/edits) with each reference as an input image. Used for lyric scenes
that continue a story."""
from __future__ import annotations

import asyncio
import base64
from pathlib import Path

import httpx

from app.services.job_service import JobCancelled

MOST = 4  # References beyond a few add cost without adding likeness.


async def request_image_with_references(config: dict, prompt: str, size: str, quality: str, references: list[Path], should_cancel) -> bytes:
    files = [('image[]', (path.name, path.read_bytes(), 'image/png' if path.suffix.lower() == '.png' else 'image/jpeg')) for path in references[:MOST]]
    data = {'model': config['model'], 'prompt': prompt, 'size': size, 'quality': quality, 'n': '1', 'output_format': 'png'}
    async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=20), follow_redirects=False) as client:
        request = asyncio.create_task(client.post(config['base_url'] + '/images/edits', headers={'Authorization': 'Bearer ' + config['api_key']}, data=data, files=files))
        while not request.done():
            if should_cancel():
                request.cancel()
                raise JobCancelled()
            await asyncio.sleep(0.5)
        response = request.result()
    if response.status_code in (401, 403):
        raise ValueError('The image provider rejected access. Check the API key and model permissions in AI settings.')
    if response.status_code == 429:
        raise ValueError('The provider limit was reached. Check credits or wait, then retry the failed scene.')
    if response.status_code >= 400:
        raise ValueError(f'The image provider could not draw this scene from the reference pictures (HTTP {response.status_code}). Try without references.')
    item = (response.json().get('data') or [{}])[0]
    if not item.get('b64_json'):
        raise ValueError('The image provider returned no picture.')
    return base64.b64decode(item['b64_json'])
