import json
import mimetypes
import shutil
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from PIL import Image, ImageOps

from app.api.schemas import VideoEditRequest, LyricSyncRequest
from app.core.config import settings
from app.db.database import get_connection
from app.services.video_service import _run_ffprobe, generate_video_poster, serve_file_with_ranges
from app.services.video_edit_service import inspect_editable_video, render_video_copy, resolve_audio_asset, media_duration, check_disk_space, LYRIC_FONTS_DIR
from app.services.job_service import get_job, update_job
from app.services.render_queue_service import enqueue_render, cancel_render, can_retry, list_render_jobs, get_stored_render_job, retry as retry_render

router = APIRouter()


from app.services.media_service import get_media, describe, index_media, song_folder
from app.services.asset_service import request_assets


@router.get('/health')
def health():
    return {'status': 'ok', 'app': 'Kanaa', 'ffmpeg': bool(shutil.which('ffmpeg'))}


@router.post('/media')
async def upload_media(file: UploadFile = File(...)):
    suffix = Path(file.filename or '').suffix.lower()
    if suffix not in {'.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp', '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'}:
        raise HTTPException(400, 'Choose a JPG, PNG, WebP, TIFF, MP4, MOV, or WebM file.')
    directory = settings.data_dir / 'media'
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (uuid.uuid4().hex + suffix)
    try:
        size = 0
        with target.open('xb') as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > 2 * 1024**3:
                    raise HTTPException(413, 'Choose a file smaller than 2 GB.')
                output.write(chunk)
        media = await run_in_threadpool(index_media, target, Path(file.filename or 'Media').name)
        if media['media_type'] == 'video':
            await run_in_threadpool(request_assets, target, media['filename'])
        return media
    except Exception as exc:
        target.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(400, 'Could not import this file. Check that it is a supported image or video.') from exc
    finally:
        await file.close()


@router.get('/photos')
def list_media(media_type: str | None = None, q: str = '', folder: str | None = None, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0), collection: str | None = None):
    where, args = ['1=1'], []
    if media_type:
        where.append('media_type=?'); args.append(media_type)
    if q:
        where.append('filename LIKE ?'); args.append('%' + q + '%')
    if collection:
        where.append('is_export=?'); args.append(int(collection == 'workspace'))
    if folder == '__unfiled__':
        where.append('folder IS NULL')
    elif folder is not None:
        where.append('folder=?'); args.append(folder)
    clause = ' AND '.join(where)
    with get_connection() as conn:
        total = conn.execute(f'SELECT COUNT(*) FROM photos WHERE {clause}', args).fetchone()[0]
        rows = conn.execute(f'SELECT * FROM photos WHERE {clause} ORDER BY id DESC LIMIT ? OFFSET ?', [*args, limit, offset]).fetchall()
    return {'photos': [describe(row) for row in rows], 'total': total, 'counts': {}}


class FolderName(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class BulkMediaFolder(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    folder: str | None = Field(default=None, max_length=60)


def clean_folder(value: str | None) -> str | None:
    return (value or '').strip() or None


def required_folder(value: str | None) -> str:
    name = clean_folder(value)
    if not name: raise HTTPException(400, 'Give the folder a name.')
    return name


@router.get('/media-folders')
def list_media_folders():
    with get_connection() as conn:
        folders = conn.execute('''SELECT f.name, COUNT(p.id) AS count FROM media_folders f
            LEFT JOIN photos p ON p.folder=f.name AND p.is_export=0 GROUP BY f.name ORDER BY f.name COLLATE NOCASE''').fetchall()
        total = conn.execute('SELECT COUNT(*) FROM photos WHERE is_export=0').fetchone()[0]
        unfiled = conn.execute('SELECT COUNT(*) FROM photos WHERE is_export=0 AND folder IS NULL').fetchone()[0]
    return {'total': total, 'unfiled': unfiled, 'folders': [dict(row) for row in folders]}


@router.post('/media-folders')
def create_media_folder(data: FolderName):
    name = required_folder(data.name)
    with get_connection() as conn:
        try: conn.execute('INSERT INTO media_folders(name) VALUES(?)', (name,)); conn.commit()
        except sqlite3.IntegrityError: raise HTTPException(409, 'A folder with this name already exists.')
    return {'name': name, 'count': 0}


@router.patch('/media-folders/{name}')
def rename_media_folder(name: str, data: FolderName):
    next_name = required_folder(data.name)
    with get_connection() as conn:
        if not conn.execute('SELECT 1 FROM media_folders WHERE name=?', (name,)).fetchone(): raise HTTPException(404, 'Folder not found.')
        if name.casefold() != next_name.casefold() and conn.execute('SELECT 1 FROM media_folders WHERE name=?', (next_name,)).fetchone(): raise HTTPException(409, 'A folder with this name already exists.')
        conn.execute('UPDATE photos SET folder=? WHERE folder=?', (next_name, name))
        conn.execute('UPDATE media_folders SET name=? WHERE name=?', (next_name, name)); conn.commit()
    return {'name': next_name}


@router.delete('/media-folders/{name}', status_code=204)
def delete_media_folder(name: str):
    with get_connection() as conn:
        if not conn.execute('SELECT 1 FROM media_folders WHERE name=?', (name,)).fetchone(): raise HTTPException(404, 'Folder not found.')
        conn.execute('UPDATE photos SET folder=NULL WHERE folder=?', (name,))
        conn.execute('DELETE FROM media_folders WHERE name=?', (name,)); conn.commit()


@router.patch('/photos/folder')
def bulk_set_media_folder(data: BulkMediaFolder):
    folder = clean_folder(data.folder)
    placeholders = ','.join('?' for _ in data.ids)
    with get_connection() as conn:
        if folder: conn.execute('INSERT OR IGNORE INTO media_folders(name) VALUES(?)', (folder,))
        cursor = conn.execute(f'UPDATE photos SET folder=? WHERE id IN ({placeholders}) AND is_export=0', [folder, *data.ids]); conn.commit()
    return {'folder': folder, 'updated': cursor.rowcount}


@router.get('/photos/{identifier}')
def media_details(identifier: int):
    return describe(get_media(identifier))


@router.get('/photos/{identifier}/recorded')
def media_recorded(identifier: int):
    """When the clip was filmed or the photo taken (local time), for a Date title. Null when the file doesn't say."""
    from app.services.media_probe import recorded_at
    return {'recorded': recorded_at(Path(get_media(identifier)['absolute_path']))}


class MediaFolder(BaseModel):
    folder: str | None = Field(default=None, max_length=60)


@router.patch('/photos/{identifier}')
def set_media_folder(identifier: int, data: MediaFolder):
    get_media(identifier)
    folder = (data.folder or '').strip() or None
    with get_connection() as conn:
        if folder: conn.execute('INSERT OR IGNORE INTO media_folders(name) VALUES(?)', (folder,))
        conn.execute('UPDATE photos SET folder=? WHERE id=?', (folder, identifier))
        conn.commit()
    return {'folder': folder}


def mentions_media(value: Any, identifier: int) -> bool:
    """Whether a project's saved work uses this media, at any depth."""
    if isinstance(value, dict):
        return any((key in ('media_id', 'photo_id') and item == identifier) or mentions_media(item, identifier) for key, item in value.items())
    return isinstance(value, list) and any(mentions_media(item, identifier) for item in value)


def first_media(value: Any) -> int | None:
    if isinstance(value, dict):
        for key, item in value.items():
            found = item if key in ('media_id', 'photo_id') and isinstance(item, int) else first_media(item)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = first_media(item)
            if found is not None:
                return found
    return None


@router.delete('/photos/{identifier}')
def delete_media(identifier: int):
    """Removes Motion's own copy. Anything a project still uses stays, so no project can break."""
    row = get_media(identifier)
    with get_connection() as conn:
        if conn.execute('SELECT 1 FROM image_scenes WHERE media_id=?', (identifier,)).fetchone():
            raise HTTPException(409, 'A lyric project still uses this as a generated scene.')
        projects = conn.execute('SELECT id, name, media_id, recipe FROM projects').fetchall()
        plans = []
        for project in projects:
            recipe = json.loads(project['recipe']) if project['recipe'] else None
            if mentions_media(recipe, identifier):
                raise HTTPException(409, f'“{project["name"]}” still uses this. Remove it from that project first.')
            if project['media_id'] == identifier:
                # Only the cover picture points here, so the project can move on to something it does use.
                cover = first_media(recipe)
                if cover is None:
                    raise HTTPException(409, f'This is the only media in “{project["name"]}”. Add something else to that project, or delete the project.')
                plans.append((cover, project['id']))
        for cover, project_id in plans:
            conn.execute('UPDATE projects SET media_id=? WHERE id=?', (cover, project_id))
        conn.execute('DELETE FROM photos WHERE id=?', (identifier,))
        conn.commit()
    path = Path(row['absolute_path']).resolve()
    if settings.data_dir.resolve() in path.parents:
        path.unlink(missing_ok=True)
    for leftover in settings.thumbnail_dir.glob(f'{identifier}[-.]*'):
        leftover.unlink(missing_ok=True)
    return {'deleted': identifier}


@router.get('/photos/{identifier}/thumbnail')
def thumbnail(identifier: int):
    row = get_media(identifier)
    settings.thumbnail_dir.mkdir(parents=True, exist_ok=True)
    target = settings.thumbnail_dir / f'{identifier}.jpg'
    if not target.exists():
        if row['media_type'] == 'image':
            with Image.open(row['absolute_path']) as image:
                image = ImageOps.exif_transpose(image).convert('RGB'); image.thumbnail((480, 480)); image.save(target, quality=85)
        elif not generate_video_poster(row['absolute_path'], target, row['duration']):
            raise HTTPException(404, 'Preview unavailable')
    return FileResponse(target)


@router.get('/photos/{identifier}/image')
def image(identifier: int):
    row = get_media(identifier)
    if row['media_type'] != 'image':
        raise HTTPException(400, 'Choose an image')
    settings.thumbnail_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(row['absolute_path']) as original:
        # JPEG has no transparency, and a logo must keep the shape it exports with.
        clear = original.mode in ('RGBA', 'LA', 'PA') or 'transparency' in original.info
        target = settings.thumbnail_dir / f"{identifier}-preview.{'png' if clear else 'jpg'}"
        if not target.exists():
            preview = ImageOps.exif_transpose(original).convert('RGBA' if clear else 'RGB')
            preview.thumbnail((2400, 2400))
            temporary = target.with_name(f'{identifier}-{uuid.uuid4().hex}{target.suffix}')
            preview.save(temporary, **({} if clear else {'quality': 92}))
            temporary.replace(target)
    return FileResponse(target)


@router.get('/photos/{identifier}/video')
def video(identifier: int, request: Request):
    path = Path(get_media(identifier)['absolute_path'])
    return serve_file_with_ranges(path, mimetypes.guess_type(path.name)[0] or 'video/mp4', request)


@router.get('/photos/{identifier}/download')
def download(identifier: int):
    row = get_media(identifier)
    return FileResponse(row['absolute_path'], filename=row['filename'])


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal['edit', 'lyric']
    media_id: int | None = None
    media_ids: list[int] = Field(default_factory=list, max_length=200)


class ProjectSave(BaseModel):
    recipe: dict | None = None


class ProjectRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def project_row(identifier):
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM projects WHERE id=?', (identifier,)).fetchone()
    if not row:
        raise HTTPException(404, 'Project not found')
    return row


@router.get('/projects')
def list_projects():
    with get_connection() as conn:
        rows = conn.execute('SELECT p.*, m.filename, m.media_type FROM projects p JOIN photos m ON m.id=p.media_id ORDER BY p.updated_at DESC,p.id DESC').fetchall()
    return [{**dict(row), 'recipe': None} for row in rows]


@router.post('/projects')
def create_project(data: ProjectCreate):
    if not data.name.strip(): raise HTTPException(400, 'Give your project a name.')
    if data.kind == 'edit':
        return create_video_project(data)
    if data.media_id is None:
        directory = settings.data_dir / 'media'; directory.mkdir(parents=True, exist_ok=True)
        path = directory / f'canvas-{uuid.uuid4().hex}.png'
        Image.new('RGB', (720, 1280), '#282334').save(path)
        media = index_media(path, 'Blank canvas.png', folder=song_folder(data.name) if data.kind == 'lyric' else None)
        data.media_id = media['id']
    media = get_media(data.media_id)
    if data.kind == 'edit' and media['media_type'] not in {'video', 'image'}:
        raise HTTPException(400, 'Choose a video or image for a video project.')
    if not data.name.strip():
        raise HTTPException(400, 'Give your project a name.')
    recipe = None
    if data.kind == 'lyric' and len(data.media_ids) > 1:
        if data.media_ids[0] != data.media_id or any(get_media(identifier)['media_type'] != 'image' for identifier in data.media_ids):
            raise HTTPException(400, 'Choose images for your slideshow.')
        recipe = json.dumps({'version': 1, 'clips': [{'photo_id': identifier} for identifier in data.media_ids]})
    with get_connection() as conn:
        cursor = conn.execute('INSERT INTO projects(name,kind,media_id,recipe) VALUES(?,?,?,?)', (data.name.strip(), data.kind, data.media_id, recipe))
        conn.commit()
        identifier = cursor.lastrowid
    return dict(project_row(identifier))


PHOTO_SECONDS = 5  # Matches PHOTO_SECONDS in frontend/src/timeline/model.ts.
BLANK_CANVAS = 'Blank canvas.png'


def blank_canvas() -> int:
    """One shared stand-in image for video projects started empty; the project needs a media record, the timeline does not use it."""
    with get_connection() as conn:
        found = conn.execute('SELECT id, absolute_path FROM photos WHERE filename = ? ORDER BY id', (BLANK_CANVAS,)).fetchall()
    for row in found:
        if Path(row['absolute_path']).is_file():
            return row['id']
    directory = settings.data_dir / 'media'; directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'canvas-{uuid.uuid4().hex}.png'
    Image.new('RGB', (720, 1280), '#282334').save(path)
    return index_media(path, BLANK_CANVAS)['id']


def starting_timeline(media_ids: list[int]) -> dict:
    """The first timeline of a new video project: the chosen clips in order on the main track, whole videos and photos
    for PHOTO_SECONDS, framed like the first one. `fresh` makes the editor ask where it will be posted when first opened;
    the editor's first save drops it."""
    items, start = [], 0.0
    for number, identifier in enumerate(media_ids, start=1):
        media = get_media(identifier)
        if media['media_type'] not in {'video', 'image'}:
            raise HTTPException(400, 'Choose videos or photos for a video project.')
        length = float(media['duration'] or PHOTO_SECONDS) if media['media_type'] == 'video' else PHOTO_SECONDS
        items.append({'id': f'clip-{number}', 'media_id': identifier, 'start': round(start, 3), 'in': 0, 'out': round(length, 3)})
        start += length
    first = get_media(media_ids[0]) if media_ids else None
    width, height = (first['width'] or 1920, first['height'] or 1080) if first else (1080, 1920)
    longest = max(width, height)
    if longest > 3840:
        width, height = round(width * 3840 / longest), round(height * 3840 / longest)
    return {'version': 2, 'fresh': True, 'format': {'width': max(240, width - width % 2), 'height': max(240, height - height % 2), 'fps': 30},
            'layers': [{'id': 'main', 'kind': 'video', 'name': 'Main', 'magnetic': True, 'items': items}]}


def create_video_project(data: ProjectCreate):
    """A blank video project, or one that starts with the chosen videos and photos in order."""
    ids = list(dict.fromkeys(data.media_ids or ([data.media_id] if data.media_id is not None else [])))
    recipe = starting_timeline(ids)
    primary = ids[0] if ids else blank_canvas()
    with get_connection() as conn:
        cursor = conn.execute('INSERT INTO projects(name,kind,media_id,recipe) VALUES(?,?,?,?)', (data.name.strip(), 'edit', primary, json.dumps(recipe)))
        conn.commit()
        identifier = cursor.lastrowid
    return dict(project_row(identifier))


@router.get('/projects/{identifier}')
def get_project(identifier: int):
    row = project_row(identifier)
    return {**dict(row), 'recipe': json.loads(row['recipe']) if row['recipe'] else None}


@router.put('/projects/{identifier}/recipe')
def save_project(identifier: int, data: ProjectSave):
    project_row(identifier)
    with get_connection() as conn:
        conn.execute('UPDATE projects SET recipe=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (json.dumps(data.recipe) if data.recipe is not None else None, identifier)); conn.commit()
    return {'success': True}


@router.patch('/projects/{identifier}')
def rename_project(identifier: int, data: ProjectRename):
    project_row(identifier)
    if not data.name.strip():
        raise HTTPException(400, 'Give your project a name.')
    with get_connection() as conn:
        conn.execute('UPDATE projects SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', (data.name.strip(), identifier)); conn.commit()
    return {'success': True}


@router.post('/projects/{identifier}/duplicate')
def duplicate_project(identifier: int):
    row = project_row(identifier)
    with get_connection() as conn:
        cursor = conn.execute('INSERT INTO projects(name,kind,media_id,recipe) VALUES(?,?,?,?)', (row['name'][:110] + ' copy', row['kind'], row['media_id'], row['recipe'])); conn.commit()
    return dict(project_row(cursor.lastrowid))


@router.delete('/projects/{identifier}')
def delete_project(identifier: int):
    with get_connection() as conn:
        active = conn.execute("SELECT 1 FROM image_batches b JOIN render_jobs j ON j.id=b.job_id WHERE b.project_id=? AND j.status IN ('queued','running','cancelling')", (identifier,)).fetchone()
        if active: raise HTTPException(409, 'Stop image generation before deleting this project.')
        conn.execute('DELETE FROM projects WHERE id=?', (identifier,)); conn.commit()
    return {'success': True}


@router.get('/fonts/{filename}')
def lyric_font(filename: str):
    if Path(filename).name != filename or not filename.endswith('.ttf') or not (LYRIC_FONTS_DIR / filename).is_file():
        raise HTTPException(404, 'Font not found')
    return FileResponse(LYRIC_FONTS_DIR / filename)


@router.get('/render-jobs')
def jobs():
    # can_retry: a failed or cancelled job Kanaa still knows how to run again (since it last started).
    return [{**job, 'can_retry': job.get('status') in ('failed', 'cancelled') and can_retry(job['job_id'])} for job in list_render_jobs()]


@router.post('/jobs/{identifier}/retry')
def retry_job(identifier: str):
    if not retry_render(identifier):
        raise HTTPException(409, 'This job can no longer be run again. Start it again from where you made it.')
    return {'success': True}


@router.get('/jobs/{identifier}/status')
def status(identifier: str):
    job = get_job(identifier) or get_stored_render_job(identifier)
    if not job:
        raise HTTPException(404, 'Job not found')
    return job


@router.post('/jobs/{identifier}/cancel')
def cancel(identifier: str):
    success = cancel_render(identifier)
    if success:
        with get_connection() as conn:
            conn.execute("UPDATE image_scenes SET status='cancelled',error='Cancelled. Completed images are saved.' WHERE batch_id IN (SELECT id FROM image_batches WHERE job_id=?) AND status IN ('queued','running')", (identifier,)); conn.commit()
    return {'success': success}


@router.post("/video-audio")
async def upload_video_audio(file: UploadFile = File(...)) -> dict[str, Any]:
    from app.services.video_service import _run_ffprobe
    directory = settings.data_dir / "video_audio"
    directory.mkdir(parents=True, exist_ok=True)
    asset_id = uuid.uuid4().hex
    target = directory / asset_id
    try:
        size = 0
        with target.open("xb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > 100 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Choose an audio file smaller than 100 MB.")
                output.write(chunk)
        info = await run_in_threadpool(_run_ffprobe, target) or {}
        duration = media_duration(info)
        if not any(stream.get("codec_type") == "audio" for stream in info.get("streams", [])) or duration <= 0 or duration > 3600:
            raise HTTPException(status_code=400, detail="Choose a readable song or audio track up to one hour long.")
        return {"asset_id": asset_id, "duration": duration, "embedded_lyrics": embedded_lyrics(info)}
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


def embedded_lyrics(info: dict[str, Any]) -> str | None:
    """Lyrics carried in the file's own tags, as music tools and Suno write them."""
    sources = [info.get("format", {}), *info.get("streams", [])]
    for source in sources:
        for key, value in source.get("tags", {}).items():
            if key.lower().startswith(("lyrics", "unsyncedlyrics")) and str(value).strip():
                return str(value)
    return None


@router.get("/video-audio/{asset_id}/beats")
def get_video_audio_beats(asset_id: str) -> dict[str, Any]:
    from app.services.beat_service import detect_beats
    try:
        beats, bpm = detect_beats(resolve_audio_asset(asset_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"beats": beats, "bpm": bpm}


@router.get("/video-audio/{asset_id}")
def get_video_audio(asset_id: str, request: Request):
    try:
        return serve_file_with_ranges(resolve_audio_asset(asset_id), "application/octet-stream", request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc



@router.post("/lyric-sync")
def start_lyric_sync(request: LyricSyncRequest):
    from app.services.lyric_sync_service import sync_lyrics
    from app.services.video_service import _run_ffprobe
    lines = [line.strip() for line in request.lyrics.splitlines() if line.strip()]
    if not lines or len(lines) > 500 or any(len(line) > 500 for line in lines):
        raise HTTPException(status_code=400, detail="Paste between 1 and 500 lyric lines, up to 500 characters each.")
    try:
        source = resolve_audio_asset(request.audio_asset_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    duration = media_duration(_run_ffprobe(source) or {})
    if duration <= 0 or duration > 3600:
        raise HTTPException(status_code=400, detail="The uploaded audio has no supported duration.")

    ready = threading.Event()

    def run(should_cancel) -> dict[str, Any]:
        ready.wait()
        cues, coverage = sync_lyrics(source, lines, duration, request.language, lambda **values: update_job(job_id, **values), should_cancel)
        estimated = sum(cue["review"] for cue in cues)
        warning = None
        if coverage < 0.2:
            warning = f"Only {coverage:.0%} of the lyric words matched, so these timings are mostly estimates. Check the language, or fix them by hand."
        elif estimated:
            warning = f"Matched {coverage:.0%} of the lyric words. Review {estimated} estimated lines before export."
        return {"progress": 100, "phase": "Synced", "lyric_cues": cues, "warning": warning}

    job_id = enqueue_render("lyric_sync", "Sync lyrics", run, total=100)
    ready.set()
    return {"job_id": job_id}



@router.post('/photos/{identifier}/video-export')
def export_video(identifier: int, edit: VideoEditRequest):
    row = get_media(identifier)
    image = row['media_type'] == 'image'
    if image and not (edit.audio_asset_id and edit.lyrics):
        raise HTTPException(400, 'Add a song and lyrics to your image project.')
    backgrounds = []
    for image_id in edit.background_photo_ids:
        media = get_media(image_id)
        if media['media_type'] != 'image':
            raise HTTPException(400, 'Choose images for the slideshow.')
        backgrounds.append((Path(media['absolute_path']), {}))
    if backgrounds and (not image or edit.canvas == 'original' or edit.background_photo_ids[0] != identifier):
        raise HTTPException(400, 'Choose a slideshow format and a valid first image.')
    if edit.slide_starts and len(edit.slide_starts) != len(backgrounds):
        raise HTTPException(400, 'Give one start time for each image.')
    source = Path(row['absolute_path'])
    target = settings.edit_workspace_dir / f'{source.stem}_{uuid.uuid4().hex[:10]}.mp4'
    try:
        duration = inspect_editable_video(source, edit, background_is_image=image)
        check_disk_space(target.parent, duration, edit.quality)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    ready = threading.Event()
    def run(should_cancel):
        ready.wait()
        try:
            render_video_copy(source, target, edit, duration, lambda progress: update_job(job_id, progress=progress), background_is_image=image, backgrounds=backgrounds, should_cancel=should_cancel)
            output = index_media(target, f"{Path(row['filename']).stem} — {'lyrics' if edit.lyrics else 'edited'}.mp4", True)
            return {'progress': 100, 'output_photo_id': output['id']}
        except Exception:
            target.unlink(missing_ok=True)
            raise
    job_id = enqueue_render('video_export', f"Export: {row['filename']}", run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.post('/lyric-video/build')
def build_lyric_video_route(body: dict, request: Request):
    """The lyric screen's Build video: the same builder an agent uses through MCP (kanaa_mcp/lyric_builder.py), run as a
    job. The result is an editor project, never exported. The job's result has `project_id`."""
    import httpx
    from kanaa_mcp import server as mcp
    from kanaa_mcp.lyric_builder import build_lyric_video
    allowed = {'name', 'song_asset_id', 'song_seconds', 'cues', 'scenes', 'look', 'lyric_motion', 'three_d', 'lights', 'lyric_font', 'lyric_colour',
               'lyric_size', 'canvas', 'presents', 'song_by', 'music', 'presented_by', 'footer', 'accent', 'logo_media_id', 'brand_intro', 'project_id', 'house_style', 'shots', 'painted', 'gentle', 'karaoke'}
    params = {key: value for key, value in body.items() if key in allowed and value not in (None, '')}
    for key in ('name', 'song_asset_id', 'song_seconds', 'cues', 'scenes'):
        if key not in params:
            raise HTTPException(400, f'Missing {key}.')
    base = str(request.base_url).rstrip('/') + '/api'

    def run(should_cancel):
        with httpx.Client(base_url=base, timeout=600) as http:
            api = mcp.KanaaApi(http)
            helpers = mcp.build_server(api).lyric_helpers
            update_job(job_id, phase='Building your lyric video', progress=5)
            result = build_lyric_video(api, *helpers, **params)
        return {'progress': 100, 'phase': 'Ready to review', 'project_id': result['project_id'], 'folder': result.get('folder'), 'pictures': result.get('pictures')}

    job_id = enqueue_render('lyric_build', f"Building {params['name']}", run, total=100)
    return {'job_id': job_id}
