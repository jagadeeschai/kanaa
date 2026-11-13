"""Signature title cards (kanaa_mcp/signature.py, signature_card_service.py): list the saved signatures, and typeset a
card for a song from one, with the song's own title."""
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.services import signature_card_service
from app.services.job_service import update_job
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render
from kanaa_mcp import signature

router = APIRouter()


@router.get('/signatures')
def list_signatures():
    """The saved signatures: name, lyricist (Tamil and English) and the credits each card carries."""
    path = signature.store(settings.data_dir)
    import json
    saved = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}
    return [{'name': name, 'lyricist': value.get('lyricist'), 'lyricist_english': value.get('lyricist_english'), 'roles': value.get('roles') or []} for name, value in saved.items()]


@router.post('/signatures/{name}/card')
def make_signature_card(name: str, body: dict):
    """A card for one song from signature `name`: {title, english, seconds (6), roles (optional, else the
    signature's own)}. A job whose result has the card's `output_photo_id` (a video to put in place of the old card)."""
    saved = signature.load(settings.data_dir, name)
    if saved is None:
        raise HTTPException(404, 'No such signature.')
    title, english = str(body.get('title') or '').strip(), str(body.get('english') or '').strip()
    if not title or len(title) > 60 or len(english) > 60:
        raise HTTPException(400, 'Give the song title (up to 60 letters).')
    seconds = float(body.get('seconds') or 6)
    roles = body.get('roles') or saved.get('roles')
    if not roles or not saved.get('photo') or not Path(saved['photo']).is_file():
        raise HTTPException(400, 'This signature has no credits or no photo saved.')
    paper = Path(get_media(int(saved['paper']))['absolute_path'])

    def run(should_cancel):
        update_job(job_id, phase='Drawing the portrait', progress=10)
        import hashlib
        key = hashlib.sha1(repr((name, title, english, roles, seconds)).encode()).hexdigest()[:16]
        target = settings.data_dir / 'media' / f'signature-{key}.mp4'
        signature_card_service.make(Path(saved['photo']), paper, target, title, english or title, roles, saved.get('lyricist'), seconds, name_english=saved.get('lyricist_english'))
        return {'progress': 100, 'output_photo_id': index_media(target, f'{title} signature card.mp4', folder='Signatures')['id']}

    job_id = enqueue_render('signature_card', f'Signature card: {title}', run, total=100)
    return {'job_id': job_id}


@router.post('/signatures/{name}/credits')
def make_signature_credits(name: str, body: dict):
    """The mid-song credit and end card for one song from signature `name`, with the song's {title, english}: at once,
    {'lower': media id, 'end': media id}. They replace the pictures of clips credit-lower-* and credit-end-card."""
    from app.services import signature_credits_service as credits
    import hashlib
    saved = signature.load(settings.data_dir, name)
    if saved is None:
        raise HTTPException(404, 'No such signature.')
    title, english = str(body.get('title') or '').strip(), str(body.get('english') or '').strip()
    if not title or len(title) > 60 or len(english) > 60:
        raise HTTPException(400, 'Give the song title (up to 60 letters).')
    roles = saved.get('roles') or []
    key = hashlib.sha1(repr((name, title, english, roles)).encode()).hexdigest()[:16]
    folder = settings.data_dir / 'media'
    low = credits.lower(folder / f'credit-lower-{key}.png', title, english, roles, saved.get('channel'))
    end = credits.end_card(folder / f'credit-end-{key}.png', title, english, roles, saved.get('rights'))
    return {'lower': index_media(low, f'{title} credit.png', folder='Signatures')['id'], 'end': index_media(end, f'{title} end card.png', folder='Signatures')['id']}
