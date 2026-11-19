"""Publish to YouTube: connect a channel once, then upload an export with its details in one click."""
import html
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.services import phone_service, youtube_service as youtube
from app.services.job_service import update_job
from app.services.media_service import get_media
from app.services.render_queue_service import enqueue_render

router = APIRouter()


def mac_only(request: Request) -> None:
    if not phone_service.is_local(request.client.host if request.client else ''):
        raise HTTPException(403, 'Connect YouTube on your Mac.')


def checked(call):
    try:
        return call()
    except youtube.YouTubeError as exc:
        raise HTTPException(400, str(exc)) from None


class ClientFile(BaseModel):
    json_text: str = Field(min_length=2, max_length=20000)


class Caption(BaseModel):
    language: str = Field(min_length=2, max_length=12, pattern=r'^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$')
    name: str = Field(default='', max_length=150)
    srt: str = Field(min_length=1, max_length=2_000_000)


class Publish(BaseModel):
    media_id: int
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default='', max_length=5000)
    tags: List[str] = Field(default_factory=list, max_length=60)
    category: Literal['music', 'film', 'people', 'entertainment', 'education', 'travel'] = 'music'
    language: Optional[str] = Field(default=None, max_length=12, pattern=r'^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$')
    privacy: Literal['private', 'unlisted', 'public'] = 'private'
    publish_at: Optional[str] = Field(default=None, max_length=40, pattern=r'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$')
    made_for_kids: bool = False
    thumbnail_media_id: Optional[int] = None
    captions: List[Caption] = Field(default_factory=list, max_length=4)
    playlist_id: Optional[str] = Field(default=None, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')


@router.get('/youtube')
def youtube_status():
    return youtube.status()


@router.put('/youtube/client')
def youtube_client(body: ClientFile, request: Request):
    mac_only(request)
    return checked(lambda: youtube.save_client(body.json_text))


@router.post('/youtube/connect')
def youtube_connect(request: Request):
    mac_only(request)
    port = request.url.port or 80
    return {'url': checked(lambda: youtube.sign_in_address(f'http://127.0.0.1:{port}/api/youtube/callback'))}


PAGE = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kanaa · YouTube</title>
<body style="font:16px -apple-system,system-ui,sans-serif;background:#0f1020;color:#eceaf6;display:grid;place-items:center;min-height:90vh;margin:0">
<div style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:22px">{title}</h1><p style="color:#b9b5d0">{text}</p></div></body>'''


@router.get('/youtube/callback', response_class=HTMLResponse)
def youtube_callback(request: Request, state: str = '', code: str = '', error: str = ''):
    mac_only(request)
    if error or not code:
        return HTMLResponse(PAGE.format(title='Not connected', text='YouTube was not connected. You can close this tab and try again in Kanaa.'), status_code=400)
    try:
        found = youtube.finish_sign_in(state, code)
    except youtube.YouTubeError as exc:
        return HTMLResponse(PAGE.format(title='Not connected', text=html.escape(str(exc))), status_code=400)
    return HTMLResponse(PAGE.format(title='YouTube is connected', text=f'Kanaa can now publish to <b>{html.escape(found["channel"] or "")}</b>. Close this tab and go back to Kanaa.'))


@router.delete('/youtube')
def youtube_disconnect(request: Request):
    mac_only(request)
    return youtube.disconnect()


@router.get('/youtube/playlists')
def youtube_playlists():
    return checked(youtube.playlists)


@router.post('/youtube/publish')
def youtube_publish(body: Publish):
    if not youtube.status()['connected']:
        raise HTTPException(400, 'Connect YouTube first.')
    row = get_media(body.media_id)
    if row['media_type'] != 'video':
        raise HTTPException(400, 'Publish an exported video.')
    path = Path(row['absolute_path'])
    thumbnail = None
    if body.thumbnail_media_id is not None:
        picture = get_media(body.thumbnail_media_id)
        if picture['media_type'] != 'image' or Path(picture['absolute_path']).suffix.lower() not in ('.png', '.jpg', '.jpeg'):
            raise HTTPException(400, 'The thumbnail must be a PNG or JPEG picture.')
        if Path(picture['absolute_path']).stat().st_size > 2 * 1024 * 1024:
            raise HTTPException(400, 'YouTube takes thumbnails up to 2 MB. Pick a smaller picture.')
        thumbnail = picture['absolute_path']
    meta = {**body.model_dump(exclude={'media_id', 'thumbnail_media_id', 'captions'}), 'thumbnail': thumbnail,
            'captions': [caption.model_dump() for caption in body.captions]}
    holder: dict = {}

    def run(should_cancel):
        def progress(value: float, phase: str):
            update_job(holder['id'], progress=round(value), phase=phase)
        result = youtube.upload_video(path, meta, progress, should_cancel)
        if body.privacy != 'private' and not body.publish_at and result.get('privacy') == 'private':
            result['notes'].insert(0, 'YouTube kept it private: Google locks uploads from apps it has not audited yet. Make it public in YouTube Studio.')
        return result

    job_id = enqueue_render('youtube_upload', f'YouTube: {body.title}', run, reserve=lambda job: holder.update(id=job), total=100)
    return {'job_id': job_id}
