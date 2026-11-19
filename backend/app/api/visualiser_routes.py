"""Music visualiser (visualiser_service.py): the song as moving light, made once and kept as a library video."""
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.database import get_connection
from app.services import visualiser_service
from app.services.job_service import update_job
from app.services.media_service import index_media
from app.services.render_queue_service import enqueue_render
from app.services.video_edit_service import resolve_audio_asset

router = APIRouter()


class VisualiserRequest(BaseModel):
    asset_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    start: float = Field(default=0, ge=0, allow_inf_nan=False)
    seconds: float = Field(gt=0.2, le=3 * 3600, allow_inf_nan=False)
    style: Literal['bars', 'circle', 'wave'] = 'bars'
    colour: str = Field(default='#7dd3fc', pattern=r'^#[0-9a-fA-F]{6}$')
    width: int = Field(ge=64, le=8192)
    height: int = Field(ge=64, le=8192)


def known(target: Path):
    with get_connection() as conn:
        row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
    return row[0] if row else None


@router.post('/visualiser')
def start_visualiser(body: VisualiserRequest):
    try:
        song = resolve_audio_asset(body.asset_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    size = visualiser_service.size_for(body.width, body.height)
    target = visualiser_service.video_path(song, body.start, body.seconds, body.style, body.colour, size)
    if target.is_file() and known(target):
        return {'status': 'ready', 'output_photo_id': known(target)}

    def run(should_cancel):
        made = visualiser_service.make(song, body.start, body.seconds, body.style, body.colour, (body.width, body.height),
                                       lambda progress: update_job(job_id, progress=progress), should_cancel)
        return {'progress': 100, 'output_photo_id': known(made) or index_media(made, f'Visualiser ({body.style}).mp4')['id']}

    job_id = enqueue_render('visualiser', f'Visualiser: {body.style}', run, total=100)
    return {'status': 'preparing', 'job_id': job_id}
