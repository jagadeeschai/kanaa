"""Remove person: people taken out of a picture, the space filled with what would be behind them.

1. Find: Apple Vision's person finder (the instance_mask helper the cut-outs use) outlines each person in the picture.
2. Mask: the chosen people, grown a little so no edge or shadow fringe is left.
3. Fill: on this Mac with LaMa (local_fill.py, free, offline), or by the image provider's masked edit request.
4. Keep: outside the mask the original pixels are pasted back, so only the person's place changes.
The original picture is never changed; the result is a new picture beside it.
"""
import asyncio
import base64
import hashlib
import io
import subprocess
import uuid
from pathlib import Path

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from app.core.config import settings
from app.services import cutout_service, instance_service
from app.services.ai_settings_service import read_settings
from app.services.job_service import JobCancelled, update_job
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render

FIND_SIDE = 1024  # The finder sees the picture at most this big; masks are scaled back up.
GROW = 0.012  # Of the picture's short side: the mask is grown this much to take edges and fringes too.
FEATHER = 0.004  # Of the short side: the soft edge where the fill meets the original.
SIZES = {'portrait': '1024x1536', 'square': '1024x1024', 'landscape': '1536x1024'}
INSTRUCTION = ('Remove the person or people in the masked area completely, including their shadows, and fill that area with '
               'the background that would naturally be behind them, matching the surrounding scene, light and perspective. '
               'Do not add any new people or objects.')


def _folder(picture: Path) -> Path:
    key = hashlib.sha256(picture.read_bytes()).hexdigest()[:16]
    return settings.data_dir / 'cache' / 'people' / key


def _finder() -> list[str]:
    return [str(cutout_service.helper(instance_service.SOURCE))]


def find_people(media_id: int, finder: list[str] | None = None) -> dict:
    """Each person in the picture, numbered from 1, with a preview where each is tinted and numbered. Cached."""
    item = dict(get_media(media_id))
    if item['media_type'] != 'image':
        raise ValueError('Remove person works on pictures.')
    picture = Path(item['absolute_path'])
    folder = _folder(picture)
    masks = sorted(folder.glob('person-*.png'))
    if not (folder / 'preview.jpg').exists():
        folder.mkdir(parents=True, exist_ok=True)
        with Image.open(picture) as opened:
            image = opened.convert('RGB')
        image.thumbnail((FIND_SIDE, FIND_SIDE))
        width, height = image.size[0] // 2 * 2, image.size[1] // 2 * 2
        image = image.resize((width, height))
        found = subprocess.run([*(finder or _finder()), str(width), str(height), 'people'], input=image.tobytes(), capture_output=True, timeout=120)
        if found.returncode != 0 or not found.stdout:
            raise RuntimeError('Could not look for people in this picture.')
        data, count, size = found.stdout, found.stdout[0], width * height
        people = []
        for number in range(count):
            mask = np.frombuffer(data[1 + number * size:1 + (number + 1) * size], np.uint8).reshape(height, width)
            if np.count_nonzero(mask > 127) >= instance_service.MIN_AREA * size:
                people.append(mask)
        people.sort(key=lambda mask: np.nonzero(mask > 127)[1].mean())  # Numbered left to right.
        for old in masks:
            old.unlink()
        preview = image.copy()
        tint = Image.new('RGB', preview.size)
        draw = ImageDraw.Draw(preview)
        for number, mask in enumerate(people, start=1):
            Image.fromarray(mask).save(folder / f'person-{number}.png')
            colour = instance_service.COLOURS[(number - 1) % len(instance_service.COLOURS)]
            tint.paste(colour, mask=Image.fromarray((mask > 127).astype(np.uint8) * 110))
        preview = Image.composite(tint, preview, Image.fromarray(np.maximum.reduce([(m > 127).astype(np.uint8) * 110 for m in people]) if people else np.zeros((height, width), np.uint8)))
        draw = ImageDraw.Draw(preview)
        for number, mask in enumerate(people, start=1):
            ys, xs = np.nonzero(mask > 127)
            x, y = int(xs.mean()), int(ys.min()) + 6
            draw.ellipse((x - 14, y, x + 14, y + 28), fill=instance_service.COLOURS[(number - 1) % len(instance_service.COLOURS)])
            draw.text((x - 4, y + 7), str(number), fill=(0, 0, 0))
        preview.save(folder / 'preview.jpg', quality=88)
        masks = sorted(folder.glob('person-*.png'))
    return {'count': len(masks), 'preview': f'/api/photos/{media_id}/people/preview'}


def preview_path(media_id: int) -> Path:
    return _folder(Path(dict(get_media(media_id))['absolute_path'])) / 'preview.jpg'


def chosen_mask(picture: Path, numbers: list[int], size: tuple[int, int]) -> Image.Image:
    """The chosen people as one mask at the picture's size, grown to take their edges too (white: remove)."""
    folder = _folder(picture)
    union = None
    for number in numbers:
        path = folder / f'person-{number}.png'
        if not path.exists():
            raise ValueError('Look for the people again: that person was not found.')
        mask = np.asarray(Image.open(path).convert('L')) > 127
        union = mask if union is None else union | mask
    if union is None:
        raise ValueError('Choose at least one person.')
    grown = Image.fromarray(union.astype(np.uint8) * 255).resize(size, Image.BILINEAR)
    reach = max(3, round(min(size) * GROW)) | 1
    return grown.filter(ImageFilter.MaxFilter(reach if reach <= 51 else 51)).point(lambda v: 255 if v > 60 else 0)


async def request_fill(config: dict, picture: bytes, mask: bytes, size: str, quality: str, should_cancel) -> bytes:
    """The provider's edit request with a mask: transparent in the mask is the area to paint."""
    files = [('image[]', ('picture.png', picture, 'image/png')), ('mask', ('mask.png', mask, 'image/png'))]
    data = {'model': config['model'], 'prompt': INSTRUCTION, 'size': size, 'quality': quality, 'n': '1', 'output_format': 'png'}
    async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=20), follow_redirects=False) as client:
        request = asyncio.create_task(client.post(config['base_url'] + '/images/edits', headers={'Authorization': 'Bearer ' + config['api_key']}, data=data, files=files))
        while not request.done():
            if should_cancel():
                request.cancel()
                raise JobCancelled()
            await asyncio.sleep(0.5)
        response = request.result()
    if response.status_code in (401, 403):
        raise ValueError('The image provider rejected access. Check the API key in AI settings.')
    if response.status_code == 429:
        raise ValueError('The provider limit was reached. Check credits or wait, then try again.')
    if response.status_code >= 400:
        raise ValueError(f'The image provider could not fill the picture (HTTP {response.status_code}). Its model may not accept a mask.')
    item = (response.json().get('data') or [{}])[0]
    if not item.get('b64_json'):
        raise ValueError('The image provider returned no picture.')
    return base64.b64decode(item['b64_json'])


def blend(original: Image.Image, filled: Image.Image, mask: Image.Image) -> Image.Image:
    """The fill inside the mask (softly edged), the original's own pixels everywhere else."""
    filled = filled.convert('RGB').resize(original.size, Image.LANCZOS)
    soft = mask.filter(ImageFilter.GaussianBlur(max(1, min(original.size) * FEATHER)))
    return Image.composite(filled, original.convert('RGB'), soft)


def start_remove(media_id: int, numbers: list[int], quality: str = 'medium', method: str = 'local') -> str:
    """`method`: 'local' fills on this Mac (LaMa), 'ai' with the image provider."""
    from app.services import local_fill
    item = dict(get_media(media_id))
    if item['media_type'] != 'image':
        raise ValueError('Remove person works on pictures.')
    if not numbers:
        raise ValueError('Choose at least one person.')
    if method == 'local' and not local_fill.available():
        raise ValueError('The fill model for this Mac is not installed: run ./install-fill.sh in the Kanaa folder, or choose the AI service.')
    config = read_settings()
    if method == 'ai' and not config['api_key']:
        raise ValueError('Add an API key in AI settings before removing people with the AI service.')
    source = Path(item['absolute_path'])
    name = Path(item.get('filename') or 'picture').stem[:60]
    with Image.open(source) as opened:
        width, height = opened.size
    chosen_mask(source, numbers, (width, height))  # Checks the choice before queueing.
    ratio = width / max(1, height)
    size = SIZES['landscape' if ratio > 1.15 else 'portrait' if ratio < 0.87 else 'square']

    def run(should_cancel):
        update_job(job_id, phase='Filling where the people were', progress=10)
        with Image.open(source) as opened:
            original = opened.convert('RGB')
        mask = chosen_mask(source, numbers, original.size)
        if method == 'local':
            update_job(job_id, phase='Filling on this Mac', progress=30)
            filled = local_fill.fill(original, mask)
            if should_cancel():
                raise JobCancelled()
            return save(blend(original, filled, mask))
        send_w, send_h = (int(v) for v in size.split('x'))
        sent = original.resize((send_w, send_h), Image.LANCZOS)
        # The provider's mask: the picture with the area to paint made transparent.
        holed = sent.convert('RGBA')
        holed.putalpha(Image.eval(mask.resize((send_w, send_h)), lambda v: 255 - v))
        pictures = []
        for image in (sent, holed):
            buffer = io.BytesIO(); image.save(buffer, 'PNG'); pictures.append(buffer.getvalue())
        filled = Image.open(io.BytesIO(asyncio.run(request_fill(config, pictures[0], pictures[1], size, quality, should_cancel))))
        if should_cancel():
            raise JobCancelled()
        return save(blend(original, filled, mask))

    def save(result: Image.Image) -> dict:
        target = settings.data_dir / 'media' / f'people-removed-{uuid.uuid4().hex}.png'
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            result.save(target)
            media = index_media(target, f'{name} (person removed).png', folder=item.get('folder'))
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return {'progress': 100, 'media_id': media['id']}

    job_id = enqueue_render('ai_edit', f'Remove person · {name}', run, total=100)
    return job_id
