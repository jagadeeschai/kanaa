"""Picture lights for a picture (picture_lights_service.py): its night sky and its lamps, only when it has them."""
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.db.database import get_connection
from app.services import picture_lights_service
from app.services.job_service import update_job
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render

router = APIRouter()


@router.post('/photos/{identifier}/lights')
def start_picture_lights(identifier: int, body: dict):
    """The picture's own lights brought alive, as a `seconds`-long video to lay over it with the Screen blend: `sky`
    (default on) twinkles a night sky and glows its moon; `lamps` (default on) flickers its oil lamps and lanterns.
    {'status': 'none', 'reason'} when the picture has neither; 'ready' with `output_photo_id` when made before;
    otherwise 'preparing' with a `job_id`."""
    item = get_media(identifier)
    if item['media_type'] != 'image':
        raise HTTPException(400, 'Picture lights work on pictures.')
    try:
        seconds = float(body.get('seconds', 5))
        sky, lamps = bool(body.get('sky', True)), bool(body.get('lamps', True))
        if not 0.5 <= seconds <= 600 or not (sky or lamps):
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose 0.5 to 600 seconds, and the sky, the lamps or both.') from exc
    picture = Path(item['absolute_path'])
    found = picture_lights_service.analyze(picture, sky, lamps)
    if found.get('reason'):
        return {'status': 'none', 'reason': found['reason']}
    has = {'sky': bool(found['sky']), 'moon': bool(found['sky'] and found['sky'].get('moon')), 'lamps': len(found['lamps'])}

    def known(target: Path):
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None

    target = picture_lights_service.video_path(picture, seconds, sky, lamps)
    if target.is_file() and known(target):
        return {'status': 'ready', 'output_photo_id': known(target), 'has': has}

    def run(should_cancel):
        made = picture_lights_service.make(picture, seconds, sky, lamps, lambda progress: update_job(job_id, progress=progress), should_cancel)
        name = f"{Path(item['filename']).stem} lights.mp4"
        return {'progress': 100, 'output_photo_id': known(made) or index_media(made, name, folder=item['folder'])['id']}

    job_id = enqueue_render('picture_lights', f"Lights: {item['filename']}", run, total=100)
    return {'status': 'preparing', 'job_id': job_id, 'has': has}


@router.post('/photos/{identifier}/night-sky')
def start_night_sky(identifier: int, body: dict):
    """Only the night sky (as /lights with lamps off); kept for agents that ask for it by name."""
    return start_picture_lights(identifier, {**body, 'sky': True, 'lamps': False})
