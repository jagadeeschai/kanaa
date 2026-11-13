"""Night sky sparkle for a picture (sky_light_service.py): only when the picture has a night sky."""
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.db.database import get_connection
from app.services import sky_light_service
from app.services.job_service import update_job
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render

router = APIRouter()


@router.post('/photos/{identifier}/night-sky')
def start_night_sky(identifier: int, body: dict):
    """Twinkling stars in the picture's night sky, a glow round its moon, and the odd shooting star, as a `seconds`-long
    video to lay over the picture with the Screen blend. {'status': 'none', 'reason'} when the picture has no night sky;
    'ready' with `output_photo_id` when made before; otherwise 'preparing' with a `job_id`."""
    item = get_media(identifier)
    if item['media_type'] != 'image':
        raise HTTPException(400, 'Night sky sparkle works on pictures.')
    try:
        seconds = float(body.get('seconds', 5))
        if not 0.5 <= seconds <= 600:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose 0.5 to 600 seconds.') from exc
    picture = Path(item['absolute_path'])
    found = sky_light_service.analyze(picture)
    if not found['night']:
        return {'status': 'none', 'reason': found['reason']}

    def known(target: Path):
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None

    target = sky_light_service.video_path(picture, seconds)
    if target.is_file() and known(target):
        return {'status': 'ready', 'output_photo_id': known(target), 'moon': found['moon']}

    def run(should_cancel):
        made = sky_light_service.make(picture, seconds, lambda progress: update_job(job_id, progress=progress), should_cancel)
        name = f"{Path(item['filename']).stem} night sky.mp4"
        return {'progress': 100, 'output_photo_id': known(made) or index_media(made, name, folder=item['folder'])['id']}

    job_id = enqueue_render('night_sky', f"Night sky: {item['filename']}", run, total=100)
    return {'status': 'preparing', 'job_id': job_id, 'moon': found['moon']}
