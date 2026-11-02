import json
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app.core.config import settings
from app.services.asset_service import content_key, folder_for, manifest_for, request_assets
from app.services.job_service import update_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render
from app.services.timeline_schema import Timeline
from app.services.timeline_service import render_timeline, upgrade_edit_recipe
from app.services.video_edit_service import check_disk_space, resolve_audio_asset
from app.services.video_service import serve_file_with_ranges
from app.db.database import get_connection

router = APIRouter()


def media_facts(identifier: int) -> MediaFacts:
    row = get_media(identifier)
    path = Path(row['absolute_path'])
    if row['media_type'] == 'image':
        return MediaFacts(path=path, media_type='image', width=row['width'], height=row['height'])
    facts = probe_video(path)
    if facts is None:
        raise ValueError(f"{row['filename']} is no longer readable.")
    return facts


def project_for(identifier: int):
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM projects WHERE id=?', (identifier,)).fetchone()
    if not row:
        raise HTTPException(404, 'Project not found')
    if row['kind'] != 'edit':
        raise HTTPException(400, 'Lyric projects use the lyric video creator.')
    return row


@router.get('/photos/{identifier}/assets')
def assets(identifier: int):
    row = get_media(identifier)
    if row['media_type'] != 'video':
        return {'status': 'unavailable'}
    return request_assets(Path(row['absolute_path']), row['filename'])


def asset_path(identifier: int, name: str) -> Path:
    key = content_key(Path(get_media(identifier)['absolute_path']))
    if not manifest_for(key):
        raise HTTPException(404, 'This clip is still being prepared.')
    return folder_for(key) / name


@router.get('/photos/{identifier}/proxy')
def proxy(identifier: int, request: Request):
    return serve_file_with_ranges(asset_path(identifier, 'proxy.mp4'), 'video/mp4', request)


@router.get('/photos/{identifier}/filmstrip')
def filmstrip(identifier: int):
    return FileResponse(asset_path(identifier, 'filmstrip.jpg'), media_type='image/jpeg')


@router.get('/photos/{identifier}/peaks')
def peaks(identifier: int):
    return json.loads(asset_path(identifier, 'peaks.json').read_text())


@router.get('/projects/{identifier}/timeline')
def get_timeline(identifier: int):
    row = project_for(identifier)
    media = get_media(row['media_id'])
    recipe = json.loads(row['recipe']) if row['recipe'] else None
    return upgrade_edit_recipe(recipe, row['media_id'], media['duration'] or 1, media['width'], media['height'])


@router.post('/projects/{identifier}/export')
def export_project(identifier: int, timeline: dict):
    row = project_for(identifier)
    try:
        parsed = Timeline.model_validate(timeline)
    except ValidationError as exc:
        first = exc.errors()[0]
        raise HTTPException(400, str(first.get('msg', 'This timeline is not valid.')).removeprefix('Value error, ')) from exc
    if parsed.duration <= 0:
        raise HTTPException(400, 'Add a clip to the timeline first.')
    target = settings.edit_workspace_dir / f'{uuid.uuid4().hex}.mp4'
    try:
        check_disk_space(target.parent, parsed.duration)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    def run(should_cancel):
        try:
            render_timeline(parsed, media_facts, resolve_audio_asset, target, lambda progress: update_job(job_id, progress=progress), should_cancel)
            output = index_media(target, f"{row['name']}.mp4", exported=True)
            return {'progress': 100, 'output_photo_id': output['id']}
        except Exception:
            target.unlink(missing_ok=True)
            raise

    job_id = enqueue_render('video_export', f"Export: {row['name']}", run, total=100)
    return {'job_id': job_id}
