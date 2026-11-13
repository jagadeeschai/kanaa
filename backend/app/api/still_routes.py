"""A picture as a still video of itself, so the tools made for video (finding people, putting a title behind them,
cut-outs) work on photos too. It looks exactly like the picture."""
import hashlib
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.db.database import get_connection
from app.services.job_service import update_job
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render

router = APIRouter()


def still_path(picture: Path, seconds: float) -> Path:
    key = hashlib.sha1(f'{hashlib.sha256(picture.read_bytes()).hexdigest()[:16]}-{round(seconds, 1)}'.encode()).hexdigest()[:16]
    return settings.data_dir / 'media' / f'still-{key}.mp4'


@router.post('/photos/{identifier}/still-video')
def make_still_video(identifier: int, body: dict):
    """{seconds}: the picture as a still video at least that long (its own size, 30 fps). 'ready' with
    `output_photo_id` when made before, otherwise a job."""
    item = get_media(identifier)
    if item['media_type'] != 'image':
        raise HTTPException(400, 'This is already a video.')
    seconds = float(body.get('seconds') or 5)
    if not 0.5 <= seconds <= 3600:
        raise HTTPException(400, 'Choose 0.5 seconds to an hour.')
    picture = Path(item['absolute_path'])
    target = still_path(picture, seconds)

    def known():
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None
    if target.is_file() and known():
        return {'status': 'ready', 'output_photo_id': known()}

    def run(should_cancel):
        update_job(job_id, phase='Making the picture a still video', progress=10)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp.mp4')
        made = subprocess.run([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-loop', '1', '-i', str(picture), '-t', f'{seconds + 0.5:.2f}', '-r', '30',
                               '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-tune', 'stillimage', '-crf', '16', '-movflags', '+faststart', str(temporary)],
                              capture_output=True, text=True)
        if made.returncode:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f'Could not make a still video of {item["filename"]}.')
        temporary.replace(target)
        name = f"{Path(item['filename']).stem} still.mp4"
        return {'progress': 100, 'output_photo_id': known() or index_media(target, name, folder=item['folder'])['id']}

    job_id = enqueue_render('still_video', f"Still video: {item['filename']}", run, total=100)
    return {'status': 'preparing', 'job_id': job_id}
