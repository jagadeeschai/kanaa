import hashlib
import json
import re
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app.core.config import settings
from app.services.asset_service import content_key, folder_for, make_peaks, manifest_for, request_assets
from app.services.job_service import get_job, update_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.media_service import describe, get_media, index_media
from app.services.render_queue_service import enqueue_render
from app.services.transcript_service import LANGUAGES, PHASE, saved_words, transcribe
from app.services.face_service import find_faces
from app.services.reverse_service import ensure_reversed, request_reversed, reversed_files
from app.services.stabilise_service import ensure_stable, request_stable, stable_files
from app.services import cutout_service, instance_service, music_library_service, voice_service
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
        choice, amount, pull = portrait
        pick = instance_service.from_choice(choice)
        facts = instance_service.ensure_portrait(facts, pick, amount, should_cancel, pull=instance_service.from_pull(pull, pick.kind if pick else 'people'))
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
def request_prepared(identifier: int, steady: bool = False, backwards: bool = False, cutout: str = '', echo: str = ''):
    """Starts making whatever copies a clip needs, one step at a time. Ready, or preparing with a job to watch."""
    from app.services import echo_service
    row = get_media(identifier)
    wanted = instance_service.parse_cutout(cutout)
    if row['media_type'] != 'video' or wanted is None or (echo and echo_service.parse(echo) is None):
        raise HTTPException(400, 'Only videos can be steadied, reversed or cut out.')
    facts, status = steady_and_reversed(identifier, steady, backwards)
    if facts is None:
        return status
    mode, pick, amount, pull, gap = wanted
    if echo and not mode:  # A cut-out clip previews its cut-out; its echo shows in the export.
        try:
            return echo_service.request_echo(facts, echo, row['filename'])
        except RuntimeError as exc:
            raise HTTPException(400, str(exc)) from exc
    try:
        if mode == 'blur':
            return instance_service.request_portrait(facts, pick, amount, row['filename'], pull)
        if pick:
            return instance_service.request(facts, pick, row['filename'], gap=gap)
        if mode == 'remove' and gap:
            return cutout_service.request_gap(facts, gap, row['filename'])
        return cutout_service.request_cutout(facts, mode, row['filename']) if mode else {'status': 'ready'}
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
def prepared_proxy(identifier: int, request: Request, steady: bool = False, backwards: bool = False, cutout: str = '', echo: str = ''):
    """The preview's copy of a clip that is steadied, reversed, cut out and/or echoed. Each step works on the one before."""
    from app.services import echo_service
    base = Path(get_media(identifier)['absolute_path'])
    target = None
    for wanted, copies in ((steady, stable_files), (backwards, reversed_files)):
        if not wanted:
            continue
        if not base.is_file():
            raise HTTPException(404, 'This copy is still being made.')
        base, target = copies(base)
    wanted = instance_service.parse_cutout(cutout)
    if wanted is None or (echo and echo_service.parse(echo) is None):
        raise HTTPException(400, 'Unknown cut-out.')
    mode, pick, amount, pull, gap = wanted
    if echo and not mode:
        target = echo_service.echo_path(base, echo)
    if mode:
        if not base.is_file():
            raise HTTPException(404, 'This copy is still being made.')
        if mode == 'blur':
            target = instance_service.portrait_paths(base, pick, amount, pull)[1]
        else:
            target = instance_service.pick_paths(base, pick, gap)[1] if pick else cutout_service.gap_cut_path(base, gap)
    if target is None or not target.is_file():
        raise HTTPException(404, 'This copy is still being made.')
    return serve_file_with_ranges(target, 'video/webm' if target.suffix == '.webm' else 'video/mp4', request)


@router.get('/music-library')
def music_library():
    """The person's own music, sorted into moods. Read from the Music app's folder; nothing there is changed."""
    return {'tracks': music_library_service.tracks(), 'folder': str(music_library_service.library_root())}


@router.get('/music-library/{track_id}/listen')
def music_listen(track_id: str, request: Request):
    try:
        path = music_library_service.path_of(track_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return serve_file_with_ranges(path, 'audio/mp4' if path.suffix.lower() in ('.m4a', '.aac') else 'audio/mpeg' if path.suffix.lower() == '.mp3' else 'application/octet-stream', request)


@router.post('/music-library/{track_id}/use')
def music_use(track_id: str):
    """The track as a song for the timeline."""
    try:
        return music_library_service.use(track_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


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


@router.post('/photos/{identifier}/scene-track')
def start_scene_track(identifier: int, body: dict):
    """How the whole scene moves, from `at` to every moment between `start` and `end` (source seconds), for a title
    locked to the scene. The track itself when it was made before, otherwise a job that makes it."""
    from app.services import cutout_service, scene_track_service
    from app.services.timeline_service import scene_track_source
    if get_media(identifier)['media_type'] != 'video':
        raise HTTPException(400, 'Only videos have a camera to follow.')
    try:
        at, start, end = (float(body[key]) for key in ('at', 'start', 'end'))
        if not 0 <= start <= at <= end or end - start > 600:
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose a moment inside the clip.') from exc
    facts = media_facts(identifier)
    source, size = scene_track_source(facts), (facts.width or 1920, facts.height or 1080)
    person_mask = cutout_service.files(facts.path)[cutout_service.MASK]
    person_mask = person_mask if person_mask.is_file() else None
    made = scene_track_service.track_path(source, start, end, at, person_mask)
    if made.is_file():
        return {'status': 'ready', 'track': json.loads(made.read_text())}
    active = SCENE_TRACK_JOBS.get(str(made))
    job = get_job(active) if active else None
    if job and not job.get('done'):
        return {'status': 'preparing', 'job_id': active}
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase='Following the camera', progress=0)
        try:
            track = scene_track_service.ensure(source, size, start, end, at, should_cancel, lambda progress: update_job(job_id, progress=progress), person_mask)
        finally:
            SCENE_TRACK_JOBS.pop(str(made), None)
        return {'progress': 100, 'phase': 'Followed', 'track': track}

    job_id = enqueue_render('scene-track', 'Follow the camera for a title', run, total=100)
    SCENE_TRACK_JOBS[str(made)] = job_id
    ready.set()
    return {'status': 'preparing', 'job_id': job_id}


SCENE_TRACK_JOBS: dict[str, str] = {}  # Track file to the job making it, so asking again while it runs does not start another.


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
    if recipe and recipe.get('fresh'):
        # A new project's first timeline: the marker only tells the editor to ask for the format; it is not timeline data.
        recipe = {key: value for key, value in recipe.items() if key != 'fresh'}
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
def export_project(identifier: int, timeline: dict, hardware: str = 'true'):
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
    use_hardware = hardware != 'false'

    def run(should_cancel):
        try:
            render_timeline(parsed, media_facts, resolve_audio_asset, target, lambda progress: update_job(job_id, progress=progress), should_cancel, prepared=lambda media_id, steady, backwards, portrait: prepared_copy(media_id, steady, backwards, portrait, should_cancel), masks=lambda facts, pick: instance_service.ensure_mask(facts, instance_service.from_choice(pick), should_cancel), voices=lambda path: voice_service.ensure_clean(path, should_cancel), hardware=use_hardware)
            output = index_media(target, f"{row['name']}.mp4", exported=True)
            return {'progress': 100, 'output_photo_id': output['id']}
        except Exception:
            target.unlink(missing_ok=True)
            raise

    job_id = enqueue_render('video_export', f"Export: {row['name']}", run, total=100)
    return {'job_id': job_id}


@router.get('/photos/{identifier}/focus')
def photo_focus(identifier: int, at: float = 0.0):
    """Where the main faces are in a photo, or in a video at `at` seconds, so a push-in aims at them. x and y are null when there are none."""
    from app.services.face_service import MODEL_NAME
    from app.services.focus_service import cached_focus
    if not (settings.model_cache_dir / 'face' / MODEL_NAME).is_file():
        # The face finder is fetched once by Blur faces; moves never download it on their own.
        return {'x': None, 'y': None, 'faces': 0, 'model': False}
    row = get_media(identifier)
    path = Path(row['absolute_path'])
    if not path.is_file():
        raise HTTPException(404, f"{row['filename']} is no longer readable.")
    try:
        return cached_focus(str(path), row['media_type'], int(row['width'] or 1920), int(row['height'] or 1080), round(max(0.0, at), 2), path.stat().st_mtime)
    except Exception as exc:  # The face finder's first use downloads it; say so plainly if that fails.
        raise HTTPException(503, f'Could not look for faces: {exc}') from exc


@router.post('/photos/{identifier}/scenes')
def start_scenes(identifier: int, body: dict):
    """Where the video changes shot between `start` and `end`, source seconds."""
    from app.services.scene_service import find_scenes
    row = get_media(identifier)
    if row['media_type'] != 'video':
        raise HTTPException(400, 'Only videos have scenes to split.')
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
        update_job(job_id, status='running', phase='Finding scene changes', progress=0)
        return {'progress': 100, 'phase': 'Found scene changes', **find_scenes(source, start, end, lambda progress: update_job(job_id, progress=progress), should_cancel)}

    job_id = enqueue_render('scenes', 'Find scene changes', run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.get('/effects')
def list_effects():
    from app.services.effect_service import EFFECTS
    return [{'id': effect.id, 'label': effect.label, 'tamil': effect.tamil, 'mood': effect.mood, 'about': effect.about, 'placement': effect.placement} for effect in EFFECTS]


@router.get('/luts')
def list_luts():
    from app.services import lut_service
    return {'folder': str(lut_service.SOURCE), 'luts': lut_service.library()}


@router.get('/luts/{lut_id}/atlas')
def lut_atlas(lut_id: str):
    from app.services import lut_service
    try:
        return FileResponse(lut_service.atlas(lut_id), media_type='image/png')
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post('/effects/{effect_id}')
def make_effect(effect_id: str, body: dict):
    """An effect clip in the project's shape: the media at once if it was made before, otherwise a job that makes it."""
    from app.services import effect_service
    effect = effect_service.BY_ID.get(effect_id)
    if not effect:
        raise HTTPException(404, 'No such effect.')
    try:
        width, height = int(body['width']), int(body['height'])
        if not (16 <= width <= 8192 and 16 <= height <= 8192):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Give the project size.') from exc
    try:
        options = effect_service.weather_options(effect_id, body.get('options'))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose valid weather effect settings.') from exc
    size = effect_service.work_size(width, height)
    target = effect_service.effect_path(effect_id, size, options)
    known = effect_service.existing_media(target)
    if known:
        return {'media': describe(get_media(known))}
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase=f'Making {effect.label}', progress=0)
        effect_service.render_effect(effect_id, size, target, lambda progress: update_job(job_id, progress=progress), should_cancel, options)
        suffix = f" · Variation {options.get('seed', 0) + 1}" if options else ''
        media = effect_service.existing_media(target) or index_media(target, f'{effect.label}{suffix}.mp4')['id']
        effect_service.file_into_effects_folder(media)
        return {'progress': 100, 'phase': f'{effect.label} ready', 'media_id': media}

    job_id = enqueue_render('effect', f'Make {effect.label}', run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.get('/face-finder')
def face_finder_status():
    """Whether the face finder is on this Mac yet. Features ask before fetching it (about 230 KB, once)."""
    from app.services.face_service import MODEL_NAME
    return {'ready': (settings.model_cache_dir / 'face' / MODEL_NAME).is_file()}


@router.post('/photos/{identifier}/reframe')
def start_reframe(identifier: int, body: dict):
    """The main person's path between `start` and `end`, source seconds, for auto-reframe."""
    from app.services.face_service import MODEL_NAME
    from app.services.reframe_service import subject_path
    row = get_media(identifier)
    if row['media_type'] != 'video':
        raise HTTPException(400, 'Only videos can be reframed to follow someone.')
    try:
        start, end = float(body['start']), float(body['end'])
        if not 0 <= start < end:
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose a part of a video to reframe.') from exc
    if not body.get('allow_download') and not (settings.model_cache_dir / 'face' / MODEL_NAME).is_file():
        raise HTTPException(409, 'The face finder is not on this Mac yet.')
    facts = media_facts(identifier)
    key = content_key(facts.path)
    source = folder_for(key) / 'proxy.mp4' if manifest_for(key) else facts.path
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase='Finding who to follow', progress=0)
        found = find_faces(source, (facts.width or 1920, facts.height or 1080), start, end, lambda progress: update_job(job_id, progress=progress), should_cancel)
        return {'progress': 100, 'phase': 'Ready to follow', 'path': subject_path(found['faces'], start, end)}

    job_id = enqueue_render('reframe', 'Find who to follow', run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.post('/best-moments')
def start_best_moments(body: dict):
    """The best stretch of each video for a story: [{media_id, length}] in, the start of each (or null for photos) out."""
    from app.services.face_service import MODEL_NAME, yunet
    from app.services.moment_service import WORK_SIZE, find_best
    try:
        items = [(int(item['media_id']), float(item['length'])) for item in body['items']]
        if not 0 < len(items) <= 50 or any(length <= 0 for _, length in items):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose the clips to look through.') from exc
    rows = [(get_media(media_id), length) for media_id, length in items]
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase='Picking the best moments', progress=0)
        # Faces count only when the face finder is already here: picking moments never downloads it.
        detect = yunet(WORK_SIZE) if (settings.model_cache_dir / 'face' / MODEL_NAME).is_file() else None
        starts: list[float | None] = []
        for number, (row, length) in enumerate(rows):
            if row['media_type'] != 'video':
                starts.append(None)
            else:
                facts = media_facts(row['id'])
                key = content_key(facts.path)
                source = folder_for(key) / 'proxy.mp4' if manifest_for(key) else facts.path
                starts.append(find_best(source, float(facts.duration or row['duration'] or 0), length, detect, should_cancel))
            update_job(job_id, progress=min(99, (number + 1) * 100 // len(rows)))
        return {'progress': 100, 'phase': 'Picked the best moments', 'starts': starts, 'faces': detect is not None}

    job_id = enqueue_render('moments', 'Pick the best moments', run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.get('/sound-effects')
def list_sound_effects():
    """Whooshes and hits: Kanaa's own two, then any in the music library (only read, never changed)."""
    from app.services import sound_effect_service
    return {'effects': sound_effect_service.effects()}


@router.post('/sound-effects/{effect_id}/use')
def use_sound_effect(effect_id: str):
    from app.services import sound_effect_service
    if not re.fullmatch(r'kanaa-(whoosh|hit|thunder)|[0-9a-f]{16}', effect_id):
        raise HTTPException(404, 'Unknown sound effect.')
    try:
        return sound_effect_service.use(effect_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get('/travel-map/status')
def travel_map_status():
    """Whether the map data is on this Mac, and how much would be downloaded."""
    from app.services import travel_map_service
    return travel_map_service.status()


@router.post('/travel-map/download')
def travel_map_download():
    """Fetches the map data once. The editor asks the person first."""
    from app.services import travel_map_service
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase='Downloading map data', progress=0)
        return {'progress': 100, 'phase': 'Map data ready', **travel_map_service.download(lambda progress: update_job(job_id, progress=progress), should_cancel)}

    job_id = enqueue_render('map-data', 'Download map data', run, total=100)
    ready.set()
    return {'job_id': job_id}


@router.get('/travel-map/places')
def travel_map_places(q: str = ''):
    from app.services import travel_map_service
    return {'places': travel_map_service.search(q[:80])}


@router.post('/travel-map')
def make_travel_map(body: dict):
    """A route map video for the trip, in the project's shape: a job whose result is the new clip's media id."""
    from app.services import travel_map_render, travel_map_service
    if not travel_map_service.status()['ready']:
        raise HTTPException(409, 'Download the map data first.')
    try:
        stops = [{'name': str(stop['name'])[:60], 'tamil': str(stop.get('tamil') or '')[:60], 'lat': float(stop['lat']), 'lon': float(stop['lon'])} for stop in body['stops']]
        modes = [str(mode) for mode in body['modes']]
        width, height = int(body['width']), int(body['height'])
        style, language = str(body.get('style', 'light')), str(body.get('language', 'en'))
        if not 2 <= len(stops) <= 6 or len(modes) != len(stops) - 1 or any(mode not in travel_map_render.MODES for mode in modes) \
                or style not in travel_map_render.STYLES or language not in ('en', 'ta', 'both') or not (16 <= width <= 8192 and 16 <= height <= 8192) \
                or any(not (-90 <= stop['lat'] <= 90 and -180 <= stop['lon'] <= 180) for stop in stops):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose 2 to 6 places and how each part of the trip is travelled.') from exc
    name = ' → '.join(stop['name'] for stop in stops)[:100]
    target = settings.data_dir / 'travel_maps' / f'{uuid.uuid4().hex}.mp4'
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase='Drawing the map', progress=0)
        result = travel_map_render.render(stops, modes, (width, height), style, language, target, lambda progress: update_job(job_id, progress=progress), should_cancel)
        media = index_media(target, f'{name}.mp4')['id']
        with get_connection() as conn:
            conn.execute('INSERT OR IGNORE INTO media_folders(name) VALUES (?)', ('Travel maps',))
            conn.execute('UPDATE photos SET folder=? WHERE id=?', ('Travel maps', media))
            conn.commit()
        return {'progress': 100, 'phase': 'Map ready', 'media_id': media, **result}

    job_id = enqueue_render('travel-map', f'Map: {name}', run, total=100)
    ready.set()
    return {'job_id': job_id}
