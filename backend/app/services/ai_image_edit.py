"""Edit with AI: a picture on the timeline redrawn from a typed request, by the image provider's edit request (the one
lyric scenes use for references). The original is never changed: the result is a new picture in the same folder,
which the editor offers to put in the clip's place."""
import asyncio
import uuid
from pathlib import Path

from PIL import Image

from app.core.config import settings
from app.services.ai_settings_service import read_settings
from app.services.image_references import request_image_with_references
from app.services.job_service import JobCancelled, update_job
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render

SIZES = {'portrait': '1024x1536', 'square': '1024x1024', 'landscape': '1536x1024'}


def size_for(width: int, height: int) -> str:
    """The provider's size nearest the picture's shape, so the result fits where the original was."""
    ratio = width / max(1, height)
    return SIZES['landscape' if ratio > 1.15 else 'portrait' if ratio < 0.87 else 'square']


def instruction(prompt: str) -> str:
    """The person's request, framed so the provider edits this picture rather than drawing a new one."""
    return ('Edit this picture. Keep its composition, people and place unless the request changes them. '
            f'Request: {prompt.strip()}')


def start_edit(media_id: int, prompt: str, quality: str = 'medium') -> str:
    if not prompt.strip():
        raise ValueError('Type what to change first.')
    item = dict(get_media(media_id))
    if not item or item['media_type'] != 'image':
        raise ValueError('Edit with AI works on pictures. For a video, take a snapshot first.')
    config = read_settings()
    if not config['api_key']:
        raise ValueError('Add an API key in AI settings before editing with AI.')
    source = Path(item['absolute_path'])
    width, height = item.get('width') or 1, item.get('height') or 1
    name = Path(item.get('filename') or 'picture').stem[:60]

    def run(should_cancel):
        update_job(job_id, phase='Asking the AI to edit the picture', progress=10)
        reference = source
        if source.suffix.lower() not in ('.png', '.jpg', '.jpeg'):
            # The provider takes PNG or JPEG: convert others (WebP, TIFF) first.
            reference = settings.data_dir / 'media' / f'ai-edit-src-{uuid.uuid4().hex}.png'
            reference.parent.mkdir(parents=True, exist_ok=True)
            Image.open(source).convert('RGB').save(reference)
        target = settings.data_dir / 'media' / f'ai-edit-{uuid.uuid4().hex}.png'
        try:
            image = asyncio.run(request_image_with_references(config, instruction(prompt), size_for(width, height), quality, [reference], should_cancel))
            if should_cancel():
                raise JobCancelled()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(image)
            media = index_media(target, f'{name} (AI edit).png', folder=item.get('folder'))
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        finally:
            if reference != source:
                reference.unlink(missing_ok=True)
        return {'progress': 100, 'media_id': media['id']}

    job_id = enqueue_render('ai_edit', f'Edit with AI · {name}', run, total=100)
    return job_id
