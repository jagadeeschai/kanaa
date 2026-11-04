import hashlib
import json
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app.core.config import settings
from app.services.asset_service import content_key, folder_for, make_peaks, manifest_for, request_assets
from app.services.job_service import update_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render
from app.services.transcript_service import LANGUAGES, PHASE, saved_words, transcribe
from app.services.face_service import find_faces
from app.services.reverse_service import ensure_reversed, request_reversed, reversed_files
from app.services.stabilise_service import ensure_stable, request_stable, stable_files
from app.services import cutout_service, instance_service, voice_service
from app.services.tracking_service import track
from app.services.stem_service import INSTALL_COMMAND, separate, stems_available
from app.services.timeline_schema import Caption, CaptionLayer, Format, ShapeMask, Text, Timeline
from app.services.timeline_service import write_shape_mask, render_text_image, render_timeline, upgrade_edit_recipe
from app.services.video_edit_service import LYRIC_FONTS_DIR, check_disk_space, resolve_audio_asset
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


def prepared_copy(identifier: int, steady: bool, backwards: bool, portrait=None, should_cancel=lambda: False) -> MediaFacts:
    """Steadied, then reversed, then the background blurred, so the steps combine. Each copy is made once."""
    facts = media_facts(identifier)
    if steady:
        facts = ensure_stable(facts, should_cancel)
    if backwards:
        facts = ensure_reversed(facts, should_cancel)
    if portrait:
        choice, amount = portrait
        facts = instance_service.ensure_portrait(facts, instance_service.from_choice(choice), amount, should_cancel)
    return facts


def steady_and_reversed(identifier: int, steady: bool, backwards: bool) -> tuple[MediaFacts | None, dict]:
    """The clip's steadied and/or reversed copy, once made: its facts, or None and the status of what is being made."""
    row = get_media(identifier)
    facts = media_facts(identifier)
    for wanted, request, ensure in ((steady, request_stable, ensure_stable), (backwards, request_reversed, ensure_reversed)):
        if not wanted:
            continue
        status = request(facts, row['filename'])
        if status['status'] != 'ready':
            return None, status
        facts = ensure(facts)
    return facts, {'status': 'ready'}


@router.post('/photos/{identifier}/prepared')
def request_prepared(identifier: int, steady: bool = False, backwards: bool = False, cutout: str = ''):
    """Starts making whatever copies a clip needs, one step at a time. Ready, or preparing with a job to watch."""
    row = get_media(identifier)
    wanted = instance_service.parse_cutout(cutout)
    if row['media_type'] != 'video' or wanted is None:
        raise HTTPException(400, 'Only videos can be steadied, reversed or cut out.')
    facts, status = steady_and_reversed(identifier, steady, backwards)
    if facts is None:
        return status
    mode, pick, amount = wanted
    try:
        if mode == 'blur':
            return instance_service.request_portrait(facts, pick, amount, row['filename'])
        if pick:
            return instance_service.request(facts, pick, row['filename'])
        return cutout_service.request_cutout(facts, cutout, row['filename']) if cutout else {'status': 'ready'}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/photos/{identifier}/instances')
def request_instances(identifier: int, kind: str = 'people', steady: bool = False, backwards: bool = False):
    """Finds each person, or each object, in the clip, for choosing. Ready with the list, or preparing."""
    row = get_media(identifier)
    if row['media_type'] != 'video' or kind not in instance_service.KINDS:
        raise HTTPException(400, 'Only videos have people or objects to find.')
    facts, status = steady_and_reversed(identifier, steady, backwards)
    if facts is None:
        return status
    try:
        status = instance_service.request(facts, instance_service.Pick(kind, None), row['filename'], joined=False)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    if status['status'] == 'ready':
        status['tracks'] = instance_service.tracks(facts.path, kind) or []
    return status


@router.get('/photos/{identifier}/instances/picture')
def instances_picture(identifier: int, kind: str = 'people', steady: bool = False, backwards: bool = False):
    """The clip with each one found tinted and numbered."""
    if kind not in instance_service.KINDS:
        raise HTTPException(400, 'Unknown kind.')
    base = prepared_base(identifier, steady, backwards)
    target = instance_service.picture_path(base, kind)
    if not target.is_file():
        raise HTTPException(404, 'Still looking.')
    return FileResponse(target, media_type='image/jpeg', headers={'Cache-Control': 'no-store'})


def prepared_base(identifier: int, steady: bool, backwards: bool) -> Path:
    """The path of the steadied and/or reversed copy a cut-out is made from, which may not exist yet."""
    base = Path(get_media(identifier)['absolute_path'])
    for wanted, copies in ((steady, stable_files), (backwards, reversed_files)):
        if wanted:
            if not base.is_file():
                raise HTTPException(404, 'This copy is still being made.')
            base = copies(base)[0]
    return base


@router.get('/photos/{identifier}/prepared-proxy')
def prepared_proxy(identifier: int, request: Request, steady: bool = False, backwards: bool = False, cutout: str = ''):
    """The preview's copy of a clip that is steadied, reversed and/or cut out. Each step works on the one before."""
    base = Path(get_media(identifier)['absolute_path'])
    target = None
    for wanted, copies in ((steady, stable_files), (backwards, reversed_files)):
        if not wanted:
            continue
        if not base.is_file():
            raise HTTPException(404, 'This copy is still being made.')
        base, target = copies(base)
    wanted = instance_service.parse_cutout(cutout)
    if wanted is None:
        raise HTTPException(400, 'Unknown cut-out.')
    mode, pick, amount = wanted
    if mode:
        if not base.is_file():
            raise HTTPException(404, 'This copy is still being made.')
        if mode == 'blur':
            target = instance_service.portrait_paths(base, pick, amount)[1]
        else:
            target = instance_service.pick_paths(base, pick)[1] if pick else cutout_service.files(base)[cutout_service.SEE_THROUGH]
    if target is None or not target.is_file():
        raise HTTPException(404, 'This copy is still being made.')
    return serve_file_with_ranges(target, 'video/webm' if target.suffix == '.webm' else 'video/mp4', request)


@router.get('/photos/{identifier}/filmstrip')
def filmstrip(identifier: int):
    return FileResponse(asset_path(identifier, 'filmstrip.jpg'), media_type='image/jpeg')


@router.get('/photos/{identifier}/peaks')
def peaks(identifier: int):
    return json.loads(asset_path(identifier, 'peaks.json').read_text())


@router.get('/video-audio/{asset_id}/peaks')
def song_peaks(asset_id: str):
    try:
        path = resolve_audio_asset(asset_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    folder = folder_for(content_key(path))
    target = folder / 'song-peaks.json'
    if not target.is_file():
        folder.mkdir(parents=True, exist_ok=True)
        make_peaks(MediaFacts(path=path, media_type='audio', has_audio=True), target)
    return json.loads(target.read_text())


def transcript_source(identifier: int, language: str) -> Path:
    if language not in LANGUAGES:
        raise HTTPException(400, 'Choose a language from the list.')
    row = get_media(identifier)
    if row['media_type'] != 'video':
        raise HTTPException(400, 'Only videos have speech to transcribe.')
    return Path(row['absolute_path'])


@router.get('/photos/{identifier}/words')
def get_words(identifier: int, language: str = 'auto'):
    return {'words': saved_words(transcript_source(identifier, language), language)}


@router.post('/photos/{identifier}/words')
def start_words(identifier: int, language: str = 'auto'):
    source = transcript_source(identifier, language)
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase=PHASE, progress=1)
        words = transcribe(source, language, lambda progress: update_job(job_id, progress=min(99, progress), phase=PHASE), should_cancel)
        return {'progress': 100, 'phase': 'Transcribed', 'word_count': len(words)}

    job_id = enqueue_render('transcript', 'Transcribe speech', run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.post('/photos/{identifier}/track')
def start_tracking(identifier: int, body: dict):
    """Follows a box from `at` forward to `end` and back to `start`, all in source seconds. The box is centre and size, 0 to 1."""
    row = get_media(identifier)
    if row['media_type'] != 'video':
        raise HTTPException(400, 'Only videos have movement to follow.')
    try:
        at, start, end = (float(body[key]) for key in ('at', 'start', 'end'))
        box = tuple(float(value) for value in body['box'])
        if len(box) != 4 or not (0 <= box[0] <= 1 and 0 <= box[1] <= 1 and 0 < box[2] <= 1 and 0 < box[3] <= 1) or not 0 <= start <= at <= end:
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Draw a box around something in the video first.') from exc
    facts = media_facts(identifier)
    key = content_key(facts.path)
    # The proxy is quicker to read and already upright and in standard colour. The original works too.
    source = folder_for(key) / 'proxy.mp4' if manifest_for(key) else facts.path
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase='Following', progress=0)
        result = track(source, (facts.width or 1920, facts.height or 1080), at, box, start, end, lambda progress: update_job(job_id, progress=progress), should_cancel)
        return {'progress': 100, 'phase': 'Followed', 'track': result}

    job_id = enqueue_render('tracking', 'Follow something in the video', run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.post('/photos/{identifier}/faces')
def start_faces(identifier: int, body: dict):
    """Every face between `start` and `end`, source seconds, each as a path a blur box can follow."""
    row = get_media(identifier)
    if row['media_type'] != 'video':
        raise HTTPException(400, 'Only videos can be searched for faces.')
    try:
        start, end = float(body['start']), float(body['end'])
        if not 0 <= start < end:
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose a part of a video to search.') from exc
    facts = media_facts(identifier)
    key = content_key(facts.path)
    source = folder_for(key) / 'proxy.mp4' if manifest_for(key) else facts.path
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase='Finding faces', progress=0)
        result = find_faces(source, (facts.width or 1920, facts.height or 1080), start, end, lambda progress: update_job(job_id, progress=progress), should_cancel)
        return {'progress': 100, 'phase': 'Found faces', **result}

    job_id = enqueue_render('faces', 'Find faces to blur', run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.post('/text-image')
def text_image(body: dict):
    """The export's own text drawing, so the preview shows the same letters. Tamil shaping can't differ."""
    try:
        item, fmt = Text.model_validate(body['text']), Format.model_validate(body['format'])
    except (KeyError, ValidationError) as exc:
        raise HTTPException(400, 'This text is not valid.') from exc
    look = {key: getattr(item, key) for key in ('text', 'style', 'position', 'color', 'size', 'subtitle', 'subtitle_size', 'subtitle_color', 'subtitle_above', 'subtitle_spacing', 'align', 'band_color', 'font', 'tamil_font')}
    key = hashlib.sha256(json.dumps([look, fmt.width, fmt.height], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:32]
    folder = settings.data_dir / 'cache' / 'text'
    target = folder / f'{key}.png'
    if not target.is_file():
        folder.mkdir(parents=True, exist_ok=True)
        render_text_image(item, fmt, target)
    return FileResponse(target, media_type='image/png')


def voice_source(media_id: int | None, asset_id: str | None) -> tuple[Path, str]:
    try:
        if asset_id:
            return resolve_audio_asset(asset_id), 'this song'
        row = get_media(int(media_id))
        return Path(row['absolute_path']), row['filename']
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose a sound to clean.') from exc


@router.post('/clean-voice')
def request_clean_voice(media_id: int | None = None, asset_id: str | None = None):
    """Starts cleaning a sound's voice if needed. Ready, or preparing with a job to watch."""
    path, label = voice_source(media_id, asset_id)
    try:
        return voice_service.request_clean(path, label)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get('/clean-voice')
def clean_voice_file(request: Request, media_id: int | None = None, asset_id: str | None = None):
    target = voice_service.clean_file(voice_source(media_id, asset_id)[0])
    if not target.is_file():
        raise HTTPException(404, 'The cleaned sound is still being made.')
    return serve_file_with_ranges(target, 'audio/flac', request)


@router.get('/fonts/{name}')
def font_file(name: str):
    """A bundled font, so the editor can show each font's name in itself."""
    target = LYRIC_FONTS_DIR / name
    if not name.endswith('.ttf') or '/' in name or not target.is_file():
        raise HTTPException(404, 'No such font.')
    return FileResponse(target, media_type='font/ttf')


@router.post('/shape-mask')
def shape_mask(body: dict):
    """The export's own shape mask as a picture, so the preview's edge is the same."""
    try:
        mask, fmt = ShapeMask.model_validate(body['mask']), Format.model_validate(body['format'])
    except (KeyError, ValidationError) as exc:
        raise HTTPException(400, 'This shape is not valid.') from exc
    key = hashlib.sha256(json.dumps([mask.points, mask.feather, fmt.width, fmt.height]).encode()).hexdigest()[:32]
    folder = settings.data_dir / 'cache' / 'shapes'
    target = folder / f'{key}.png'
    if not target.is_file():
        folder.mkdir(parents=True, exist_ok=True)
        write_shape_mask(mask, fmt.width, fmt.height, target)
    return FileResponse(target, media_type='image/png')


@router.post('/caption-image')
def caption_image(body: dict):
    """One caption in its layer's look, with word `lit` coloured, drawn by the export's own text code."""
    try:
        caption, fmt = Caption.model_validate(body['caption']), Format.model_validate(body['format'])
        layer = CaptionLayer.model_validate({**body['layer'], 'kind': 'captions', 'id': 'look', 'items': []})
        lit = body.get('lit')
        lit = None if lit is None else int(lit)
    except (KeyError, TypeError, ValueError, ValidationError) as exc:
        raise HTTPException(400, 'This caption is not valid.') from exc
    look = [caption.text, lit, layer.style, layer.position, layer.color, layer.highlight, layer.size, fmt.width, fmt.height]
    key = hashlib.sha256(json.dumps(look, ensure_ascii=False).encode()).hexdigest()[:32]
    folder = settings.data_dir / 'cache' / 'text'
    target = folder / f'caption-{key}.png'
    if not target.is_file():
        folder.mkdir(parents=True, exist_ok=True)
        render_text_image(Text(id='caption', start=0, length=1, text=caption.text), fmt, target, layer=layer, lit=lit)
    return FileResponse(target, media_type='image/png')


@router.get('/stems')
def stems_status():
    return {'available': stems_available(), 'install_command': INSTALL_COMMAND}


@router.post('/stems')
def start_stems(source: dict):
    asset_id, media_id = source.get('asset_id'), source.get('media_id')
    try:
        path = resolve_audio_asset(asset_id) if asset_id else Path(get_media(int(media_id))['absolute_path'])
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    if not stems_available():
        raise HTTPException(400, f'Voice separation is not installed. Run {INSTALL_COMMAND} in the Kanaa folder, then restart Kanaa.')

    def run(should_cancel):
        update_job(job_id, status='running', phase='Separating voice and music', progress=0)
        stems = separate(path, lambda progress: update_job(job_id, progress=min(99, progress)), should_cancel)
        return {'progress': 100, 'phase': 'Separated', 'stems': stems}

    job_id = ''
    ready = threading.Event()

    def start(should_cancel):
        ready.wait()
        return run(should_cancel)

    job_id = enqueue_render('stems', 'Separate voice and music', start, total=100)
    ready.set()
    return {'job_id': job_id}


@router.get('/projects/{identifier}/timeline')
def get_timeline(identifier: int):
    row = project_for(identifier)
    media = get_media(row['media_id'])
    recipe = json.loads(row['recipe']) if row['recipe'] else None
    return upgrade_edit_recipe(recipe, row['media_id'], media['duration'] or 1, media['width'], media['height'])


def preview_file(identifier: int) -> Path:
    return settings.data_dir / 'cache' / 'previews' / f'{identifier}.mp4'


@router.post('/projects/{identifier}/preview-render')
def preview_render(identifier: int, timeline: dict):
    """A quick flattened copy for watching a project too heavy to play live. It stays out of the library."""
    project_for(identifier)
    try:
        parsed = Timeline.model_validate(timeline)
    except ValidationError as exc:
        raise HTTPException(400, str(exc.errors()[0].get('msg', 'This timeline is not valid.')).removeprefix('Value error, ')) from exc
    if parsed.duration <= 0:
        raise HTTPException(400, 'Add a clip to the timeline first.')
    target = preview_file(identifier)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        check_disk_space(target.parent, parsed.duration)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    fresh = target.with_name(f'{identifier}-{uuid.uuid4().hex}.mp4')

    def run(should_cancel):
        try:
            render_timeline(parsed, media_facts, resolve_audio_asset, fresh, lambda progress: update_job(job_id, progress=progress), should_cancel, draft=True, prepared=lambda media_id, steady, backwards, portrait: prepared_copy(media_id, steady, backwards, portrait, should_cancel), masks=lambda facts, pick: instance_service.ensure_mask(facts, instance_service.from_choice(pick), should_cancel), voices=lambda path: voice_service.ensure_clean(path, should_cancel))
            fresh.replace(target)
            return {'progress': 100, 'preview_ready': True}
        finally:
            fresh.unlink(missing_ok=True)

    job_id = enqueue_render('preview_render', 'Render preview', run, total=100)
    return {'job_id': job_id}


@router.get('/projects/{identifier}/preview-render')
def preview_render_file(identifier: int, request: Request):
    target = preview_file(identifier)
    if not target.is_file():
        raise HTTPException(404, 'This preview is no longer available.')
    return serve_file_with_ranges(target, 'video/mp4', request)


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
            render_timeline(parsed, media_facts, resolve_audio_asset, target, lambda progress: update_job(job_id, progress=progress), should_cancel, prepared=lambda media_id, steady, backwards, portrait: prepared_copy(media_id, steady, backwards, portrait, should_cancel), masks=lambda facts, pick: instance_service.ensure_mask(facts, instance_service.from_choice(pick), should_cancel), voices=lambda path: voice_service.ensure_clean(path, should_cancel))
            output = index_media(target, f"{row['name']}.mp4", exported=True)
            return {'progress': 100, 'output_photo_id': output['id']}
        except Exception:
            target.unlink(missing_ok=True)
            raise

    job_id = enqueue_render('video_export', f"Export: {row['name']}", run, total=100)
    return {'job_id': job_id}
