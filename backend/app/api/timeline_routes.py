import hashlib
import json
import re
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
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
from app.services.explainer_graphics import state_count
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


@router.post('/photos/{identifier}/surface')
def surface_at_spot(identifier: int, body: dict):
    """How the surface at a spot of a video (x, y: 0..1 of the source picture, at `t` source seconds) faces the camera:
    the pose a title needs to lie on it. `kind` (floor, wall, upright, sky) says what it is; none to guess."""
    from app.services import surface_service
    from app.services.sky_service import find_sky
    from app.services.timeline_service import scene_track_source
    from app.services.tracking_service import FPS, frames
    if get_media(identifier)['media_type'] != 'video':
        raise HTTPException(400, 'Place in scene works on videos.')
    try:
        t, x, y = (float(body[key]) for key in ('t', 'x', 'y'))
        if not (t >= 0 and 0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose a spot in the picture.') from exc
    kind = body.get('kind')
    if kind is not None and kind not in surface_service.KINDS:
        raise HTTPException(400, 'Choose floor, wall, upright or sky.')
    facts = media_facts(identifier)
    width, height = facts.width or 1920, facts.height or 1080
    size = (1280, max(2, round(height * 1280 / width / 2) * 2))
    picture = next(frames(scene_track_source(facts), round(t * FPS), 1, size), None)
    if picture is None:
        raise HTTPException(400, 'That moment is past the end of the video.')
    return surface_service.surface_at(picture, x, y, None if kind else find_sky(picture), kind)


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
    horizon = body.get('horizon') is True  # Sky only in front of the title: it rides the skyline.
    region = body.get('region')
    try:
        region = (min(1.0, max(0.0, float(region[0]))), min(1.0, max(0.0, float(region[1])))) if region else None
    except (TypeError, ValueError, IndexError) as exc:
        raise HTTPException(400, 'Choose a spot in the picture.') from exc
    upright = body.get('upright') is True
    made = scene_track_service.track_path(source, start, end, at, person_mask, horizon, region, upright)
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
            track = scene_track_service.ensure(source, size, start, end, at, should_cancel, lambda progress: update_job(job_id, progress=progress), person_mask, horizon, region, upright)
        finally:
            SCENE_TRACK_JOBS.pop(str(made), None)
        return {'progress': 100, 'phase': 'Followed', 'track': track}

    job_id = enqueue_render('scene-track', 'Follow the camera for a title', run, total=100)
    SCENE_TRACK_JOBS[str(made)] = job_id
    ready.set()
    return {'status': 'preparing', 'job_id': job_id}


SCENE_TRACK_JOBS: dict[str, str] = {}  # Track file to the job making it, so asking again while it runs does not start another.


@router.post('/photos/{identifier}/people-grid')
def start_people_grid(identifier: int, body: dict):
    """Where people are, coarsely, between `start` and `end` (source seconds), for a title that keeps clear of them.
    `pick` is a clip's cutout_pick (null: every person); `steady`/`backwards` choose the copy the clip shows.
    The grid itself when it was made before, otherwise a job that makes it (and the mask, if needed)."""
    from app.services import people_grid_service
    from app.services.timeline_schema import CutoutPick
    if get_media(identifier)['media_type'] != 'video':
        raise HTTPException(400, 'Only videos have people moving through them.')
    try:
        start, end = float(body['start']), float(body['end'])
        if not 0 <= start < end or end - start > 600:
            raise ValueError
        pick = instance_service.from_choice(CutoutPick.model_validate(body['pick']) if body.get('pick') else None)
    except (KeyError, TypeError, ValueError, ValidationError) as exc:
        raise HTTPException(400, 'Choose a part of the clip.') from exc
    base = prepared_base(identifier, bool(body.get('steady')), bool(body.get('backwards')))
    if not base.is_file():
        raise HTTPException(404, 'This copy is still being made.')
    everyone = instance_service.is_everyone(pick)
    known = cutout_service.files(base)[cutout_service.MASK] if everyone else instance_service.pick_paths(base, pick)[0]
    if known.is_file():
        made = people_grid_service.grid_path(base, known, start, end)
        if made.is_file():
            return {'status': 'ready', 'grid': json.loads(made.read_text())}
    key = f'{base}|{pick}|{start:.3f}|{end:.3f}'
    active = PEOPLE_GRID_JOBS.get(key)
    job = get_job(active) if active else None
    if job and not job.get('done'):
        return {'status': 'preparing', 'job_id': active}
    ready = threading.Event()

    def run(should_cancel):
        ready.wait()
        update_job(job_id, status='running', phase='Finding where people are', progress=0)
        try:
            facts = probe_video(base)
            if facts is None:
                raise RuntimeError('This clip could not be read.')
            mask = instance_service.ensure_mask(facts, pick, should_cancel)
            grid = people_grid_service.ensure(base, mask, start, end, should_cancel, lambda progress: update_job(job_id, progress=progress))
        finally:
            PEOPLE_GRID_JOBS.pop(key, None)
        return {'progress': 100, 'phase': 'Found where people are', 'grid': grid}

    job_id = enqueue_render('people-grid', 'Keep a title clear of people', run, total=100)
    PEOPLE_GRID_JOBS[key] = job_id
    ready.set()
    return {'status': 'preparing', 'job_id': job_id}


PEOPLE_GRID_JOBS: dict[str, str] = {}


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
    lit = body.get('lit') if item.karaoke else None
    if lit is not None and not isinstance(lit, int):
        raise HTTPException(400, 'This text is not valid.')
    graphic_frame = body.get('graphic_frame') if item.graphic else None
    graphic_states = state_count(item, fmt.fps)
    if graphic_frame is not None and (not isinstance(graphic_frame, int) or not 0 <= graphic_frame < graphic_states):
        raise HTTPException(400, 'This graphic frame is not valid.')
    suffix = f'.graphic{graphic_frame}.png' if graphic_frame is not None else '.png' if lit is None else f'.lit{lit}.png'
    target = text_cache(item, fmt).with_suffix(suffix)
    if not target.is_file():
        target.parent.mkdir(parents=True, exist_ok=True)
        render_text_image(item, fmt, target, lit=lit, graphic_progress=1 if graphic_frame is None else graphic_frame / (graphic_states - 1))
    return FileResponse(target, media_type='image/png')


@router.post('/text-hole')
def text_hole(body: dict):
    """Where to fly into a video-inside-text title: the middle of its thickest letter, as shares of the frame."""
    from app.services.zoom_reveal import deepest_point
    try:
        item, fmt = Text.model_validate(body['text']), Format.model_validate(body['format'])
    except (KeyError, ValidationError) as exc:
        raise HTTPException(400, 'This text is not valid.') from exc
    if not item.knockout:
        raise HTTPException(400, 'Turn on Video inside the letters first.')
    target = text_cache(item, fmt).with_suffix('.png')
    if not target.is_file():
        target.parent.mkdir(parents=True, exist_ok=True)
        render_text_image(item, fmt, target)
    x, y = deepest_point(target)
    return {'x': x, 'y': y}


@router.post('/skyline')
def find_skyline(body: dict):
    """Sit on the skyline: where the land meets the sky behind a title, at each moment asked, and where the title's
    letters are (shares of the frame, unmoved). Works out the clip's depth first when it isn't yet (a background job)."""
    from app.services import depth_mask_service
    from app.services.job_service import update_job
    from app.services.render_queue_service import enqueue_render
    try:
        item, fmt = Text.model_validate(body['text']), Format.model_validate(body['format'])
        facts = media_facts(int(body['media_id']))
        times = [float(value) for value in body['times']][:200]
    except (KeyError, ValueError, TypeError, ValidationError) as exc:
        raise HTTPException(400, 'This title or clip is not valid.') from exc
    if facts.media_type != 'video':
        raise HTTPException(400, 'Sit on the skyline needs a video clip under the title.')
    if not depth_mask_service.map_path(facts.path).is_file():
        holder: dict = {}

        def run(should_cancel):
            depth_mask_service.make_depth_map(facts, lambda value: update_job(holder['id'], progress=value), should_cancel)
            return {'progress': 100}
        job_id = enqueue_render('depth_map', 'Finding how near everything is', run, reserve=lambda job: holder.update(id=job), total=100)
        return {'status': 'preparing', 'job_id': job_id}
    target = text_cache(item.model_copy(update={'transform': item.transform.model_copy(update={'x': 0.5, 'y': 0.5, 'scale': 1, 'keyframes': {}})}), fmt).with_suffix('.png')
    if not target.is_file():
        target.parent.mkdir(parents=True, exist_ok=True)
        render_text_image(item, fmt, target)
    from PIL import Image
    import numpy as np
    with Image.open(target) as picture:
        alpha = np.asarray(picture.convert('RGBA'))[..., 3]
    rows, cols = np.nonzero(alpha > 40)
    if not rows.size:
        raise HTTPException(400, 'This title has no letters to place.')
    box = [float(cols.min() / fmt.width), float(rows.min() / fmt.height), float((cols.max() + 1) / fmt.width), float((rows.max() + 1) / fmt.height)]
    x = item.transform.x; scale = item.transform.scale
    x0, x1 = x + (box[0] - 0.5) * scale, x + (box[2] - 0.5) * scale
    return {'status': 'ready', 'box': box, 'skyline': depth_mask_service.skyline(facts, times, max(0.0, x0), min(1.0, x1))}


@router.post('/photos/{identifier}/depth-at')
def depth_at_spot(identifier: int, body: dict):
    """How near a spot of a video is (x, y: 0..1 of the source picture, at `t` source seconds), 0 far to 1 near, so a
    title placed there can go behind everything nearer. Works out the clip's depth first when it isn't yet (a job)."""
    from app.services import depth_mask_service
    from app.services.job_service import update_job
    from app.services.render_queue_service import enqueue_render
    try:
        t, x, y = (float(body[key]) for key in ('t', 'x', 'y'))
        if not (t >= 0 and 0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose a spot in the picture.') from exc
    facts = media_facts(identifier)
    if facts.media_type != 'video':
        raise HTTPException(400, 'Put it in the scene works on videos.')
    if not depth_mask_service.map_path(facts.path).is_file():
        holder: dict = {}

        def run(should_cancel):
            depth_mask_service.make_depth_map(facts, lambda value: update_job(holder['id'], progress=value), should_cancel)
            return {'progress': 100}
        job_id = enqueue_render('depth_map', 'Finding how near everything is', run, reserve=lambda job: holder.update(id=job), total=100)
        return {'status': 'preparing', 'job_id': job_id}
    try:
        return {'status': 'ready', 'near': depth_mask_service.nearness_at(facts, t, x, y)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/photos/{identifier}/lens')
def cinematic_lens(identifier: int, body: dict):
    """Cinematic lens: a copy of the clip's part with real depth of field (lens_service.py), as a library video."""
    from app.db.database import get_connection
    from app.services import lens_service
    from app.services.job_service import update_job
    from app.services.media_service import index_media
    from app.services.render_queue_service import enqueue_render
    try:
        facts = media_facts(identifier)
        start, end = float(body['start']), float(body['end'])
        preset, strength = str(body.get('preset', 'portrait')), str(body.get('strength', 'medium'))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(400, 'This clip is not valid.') from exc
    if facts.media_type != 'video':
        raise HTTPException(400, 'The cinematic lens needs a video clip.')
    if preset not in ('portrait', 'dreamy', 'rack-out', 'rack-in') or strength not in lens_service.STRENGTH or not 0 <= start < end:
        raise HTTPException(400, 'Choose a lens and a part of the clip.')
    end = min(end, facts.duration or end)
    focus, amount, glow = lens_service.plan(preset, strength, end - start)
    target = lens_service.target_path(facts.path, start, end, focus, amount, glow)

    def known():
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None
    if target.is_file() and known():
        return {'status': 'ready', 'output_photo_id': known()}
    holder: dict = {}

    def run(should_cancel):
        made = lens_service.make(facts, start, end, focus, amount, glow, lambda value: update_job(holder['id'], progress=value), should_cancel)
        return {'progress': 100, 'output_photo_id': known() or index_media(made, f'{facts.path.stem} (cinematic lens).mp4')['id']}
    job_id = enqueue_render('lens', 'Cinematic lens', run, reserve=lambda job: holder.update(id=job), total=100)
    return {'status': 'preparing', 'job_id': job_id}


@router.post('/photos/{identifier}/atmosphere')
def atmosphere(identifier: int, body: dict):
    """Atmosphere from depth: a copy of the clip's part with mist, haze or fog laid in by distance (atmosphere_service.py)."""
    from app.db.database import get_connection
    from app.services import atmosphere_service
    from app.services.job_service import update_job
    from app.services.media_service import index_media
    from app.services.render_queue_service import enqueue_render
    try:
        facts = media_facts(identifier)
        start, end = float(body['start']), float(body['end'])
        preset, strength = str(body.get('preset', 'mist')), str(body.get('strength', 'medium'))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(400, 'This clip is not valid.') from exc
    if facts.media_type != 'video':
        raise HTTPException(400, 'Atmosphere needs a video clip.')
    if preset not in atmosphere_service.PRESETS or strength not in atmosphere_service.STRENGTH or not 0 <= start < end:
        raise HTTPException(400, 'Choose an atmosphere and a part of the clip.')
    end = min(end, facts.duration or end)
    target = atmosphere_service.target_path(facts.path, start, end, preset, strength)

    def known():
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None
    if target.is_file() and known():
        return {'status': 'ready', 'output_photo_id': known()}
    holder: dict = {}

    def run(should_cancel):
        made = atmosphere_service.make(facts, start, end, preset, strength, lambda value: update_job(holder['id'], progress=value), should_cancel)
        return {'progress': 100, 'output_photo_id': known() or index_media(made, f'{facts.path.stem} ({preset} atmosphere).mp4')['id']}
    job_id = enqueue_render('atmosphere', 'Atmosphere', run, reserve=lambda job: holder.update(id=job), total=100)
    return {'status': 'preparing', 'job_id': job_id}


@router.post('/match-cuts')
def find_match_cuts(body: dict):
    """Match-cut finder: the clips that cut together seamlessly, end of one into start of another (match_cut_service).
    A background job; its result has the suggestions."""
    from app.services import match_cut_service
    from app.services.job_service import update_job
    from app.services.render_queue_service import enqueue_render
    from app.services.timeline_service import scene_track_source
    try:
        clips = [{'id': str(each['id']), 'media_id': int(each['media_id']), 'in': float(each['in']), 'out': float(each['out'])} for each in body['clips']][:40]
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(400, 'These clips are not valid.') from exc
    if len(clips) < 2:
        raise HTTPException(400, 'Add at least two clips to the main track to find match cuts.')

    def path_of(media_id: int):
        try:
            facts = media_facts(media_id)
        except HTTPException:
            return None
        return scene_track_source(facts) if facts.media_type == 'video' else None  # The proxy when there is one: quicker.
    holder: dict = {}

    def run(should_cancel):
        found = match_cut_service.find(clips, path_of, lambda value: update_job(holder['id'], progress=value), should_cancel)
        return {'progress': 100, 'suggestions': found}
    job_id = enqueue_render('match_cuts', 'Finding match cuts', run, reserve=lambda job: holder.update(id=job), total=100)
    return {'job_id': job_id}


@router.post('/multicam-sync')
def multicam_sync(body: dict):
    """Multicam sync by sound: where each recording starts on the first one's clock (multicam_service). A job."""
    from app.services import multicam_service
    from app.services.job_service import update_job
    from app.services.render_queue_service import enqueue_render
    try:
        ids = [int(each) for each in body['media_ids']][:6]
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(400, 'These recordings are not valid.') from exc
    if len(ids) < 2:
        raise HTTPException(400, 'Choose at least two recordings of the same moment.')
    facts = [media_facts(each) for each in ids]
    if any(each.media_type != 'video' for each in facts):
        raise HTTPException(400, 'Multicam works on videos with sound.')
    holder: dict = {}

    def run(should_cancel):
        found = multicam_service.sync([each.path for each in facts], lambda value: update_job(holder['id'], progress=value), should_cancel)
        return {'progress': 100, 'angles': [{'media_id': media_id, **each} for media_id, each in zip(ids, found)]}
    job_id = enqueue_render('multicam', 'Syncing angles by sound', run, reserve=lambda job: holder.update(id=job), total=100)
    return {'job_id': job_id}


@router.post('/photos/{identifier}/freeze3d')
def time_freeze_3d(identifier: int, body: dict):
    """Time freeze in 3D: the camera moving around one frozen moment of a clip (time_freeze_service.py), as a video."""
    from app.db.database import get_connection
    from app.services import time_freeze_service
    from app.services.job_service import update_job
    from app.services.media_service import index_media
    from app.services.render_queue_service import enqueue_render
    try:
        facts = media_facts(identifier)
        at, seconds, move = float(body['at']), float(body.get('seconds', 3)), str(body.get('move', 'orbit-right'))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(400, 'This clip is not valid.') from exc
    if facts.media_type != 'video':
        raise HTTPException(400, 'The time freeze needs a video clip.')
    if move not in time_freeze_service.MOVES or not 1 <= seconds <= 8 or not 0 <= at <= (facts.duration or at):
        raise HTTPException(400, 'Choose a moment, a move and how long it lasts.')
    target = time_freeze_service.target_path(facts.path, at, seconds, move)

    def known():
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None
    if target.is_file() and known():
        return {'status': 'ready', 'output_photo_id': known()}
    holder: dict = {}

    def run(should_cancel):
        made = time_freeze_service.make(facts, at, seconds, move, lambda value: update_job(holder['id'], progress=value), should_cancel)
        return {'progress': 100, 'output_photo_id': known() or index_media(made, f'{facts.path.stem} (time freeze).mp4')['id']}
    job_id = enqueue_render('freeze3d', 'Time freeze in 3D', run, reserve=lambda job: holder.update(id=job), total=100)
    return {'status': 'preparing', 'job_id': job_id}


@router.post('/photos/{identifier}/slowmo')
def smooth_slowmo(identifier: int, body: dict):
    """Smooth slow motion: a copy of the clip's part with new frames made between its own (slowmo_service.py)."""
    from app.db.database import get_connection
    from app.services import slowmo_service
    from app.services.job_service import update_job
    from app.services.media_service import index_media
    from app.services.render_queue_service import enqueue_render
    try:
        facts = media_facts(identifier)
        start, end, factor = float(body['start']), float(body['end']), int(body['factor'])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(400, 'This clip is not valid.') from exc
    if facts.media_type != 'video':
        raise HTTPException(400, 'Smooth slow motion needs a video clip.')
    if factor not in slowmo_service.FACTORS or not 0 <= start < end:
        raise HTTPException(400, 'Choose half, a quarter or an eighth speed.')
    end = min(end, facts.duration or end)
    target = slowmo_service.target_path(facts.path, start, end, factor)

    def known():
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None
    if target.is_file() and known():
        return {'status': 'ready', 'output_photo_id': known()}
    holder: dict = {}

    def run(should_cancel):
        made = slowmo_service.make(facts, start, end, factor, lambda value: update_job(holder['id'], progress=value), should_cancel)
        return {'progress': 100, 'output_photo_id': known() or index_media(made, f'{facts.path.stem} (slow motion {factor}x).mp4')['id']}
    job_id = enqueue_render('slowmo', f'Smooth slow motion ({factor}x)', run, reserve=lambda job: holder.update(id=job), total=100)
    return {'status': 'preparing', 'job_id': job_id}


def text_cache(item: Text, fmt: Format) -> Path:
    """Where a title's picture (and its letter map) is kept: one name for each look and frame size."""
    look = {key: getattr(item, key) for key in ('text', 'style', 'position', 'color', 'size', 'subtitle', 'subtitle_size', 'subtitle_color', 'subtitle_above', 'subtitle_spacing', 'spacing', 'align', 'band_color', 'font', 'tamil_font', 'design', 'knockout', 'knockout_wash')}
    look['fill'] = item.fill.model_dump() if item.fill else None
    look['graphic'] = item.graphic.model_dump(by_alias=True) if item.graphic else None
    from app.services.font_service import own_dir
    look['own_fonts'] = sorted(path.name for path in own_dir().glob('*')) if own_dir().is_dir() else []  # A font added later redraws the title.
    if item.karaoke:
        look['karaoke'] = [item.karaoke.color, item.karaoke.glow]  # Only the colour and glow change the pictures; times and levels pick which one shows.
    key = hashlib.sha256(json.dumps([look, fmt.width, fmt.height], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:32]
    return settings.data_dir / 'cache' / 'text' / key


@router.post('/text-letters')
def text_letters(body: dict):
    """Where each letter of a title is (title_letters.py), for letter-by-letter animations: each letter's box in the
    picture's pixels, and the letter map as a PNG (red = the letter's number, 0 for none). The export finds the same."""
    import base64
    from app.services.title_letters import letters_for
    try:
        item, fmt = Text.model_validate(body['text']), Format.model_validate(body['format'])
    except (KeyError, ValidationError) as exc:
        raise HTTPException(400, 'This text is not valid.') from exc
    base = text_cache(item, fmt)
    found, picture = base.with_name(base.name + '-letters.json'), base.with_name(base.name + '-letters.png')
    if not (found.is_file() and picture.is_file()):
        from PIL import Image
        labels, boxes = letters_for(item, fmt)
        base.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(labels, 'L').save(picture)
        found.write_text(json.dumps(boxes))
    from app.services.title_letters import word_numbers
    return {'boxes': json.loads(found.read_text()), 'labels': 'data:image/png;base64,' + base64.b64encode(picture.read_bytes()).decode(), 'words': word_numbers(item)}


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
    """A bundled font or one of yours, so the editor can show each font's name in itself."""
    from app.services.font_service import font_file as find
    target = find(name)
    if target is None:
        raise HTTPException(404, 'No such font.')
    return FileResponse(target, media_type='font/otf' if target.suffix.lower() == '.otf' else 'font/ttf')


@router.get('/own-fonts')
def own_fonts():
    from app.services.font_service import own_fonts as listed
    return listed()


@router.post('/own-fonts')
async def add_own_font(file: UploadFile = File(...)):
    from app.services.font_service import MAX_BYTES, add_font
    data = await file.read(MAX_BYTES + 1)
    try:
        return add_font(file.filename or '', data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete('/own-fonts/{name}')
def remove_own_font(name: str):
    from app.services.font_service import remove_font
    try:
        remove_font(name)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {'success': True}


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
    look = [caption.text, lit, layer.style, layer.position, layer.color, layer.highlight, layer.size, layer.shared_images, fmt.width, fmt.height]
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


@router.post('/projects/{identifier}/look')
def look_render(identifier: int, body: dict):
    """A short silent draft of one stretch of a project (its saved timeline, or `timeline` when given), for an agent or a
    test to look at: `start` and `end` in timeline seconds, at most 10 seconds. The job's result has the file's `path`."""
    row = project_for(identifier)
    try:
        start, end = float(body['start']), float(body['end'])
        if not (0 <= start < end and end - start <= 10):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose a stretch of up to 10 seconds.') from exc
    try:
        parsed = Timeline.model_validate(body.get('timeline') or json.loads(row['recipe'] or 'null'))
    except ValidationError as exc:
        raise HTTPException(400, str(exc.errors()[0].get('msg', 'This timeline is not valid.')).removeprefix('Value error, ')) from exc
    target = settings.data_dir / 'cache' / 'looks' / f'{identifier}-{uuid.uuid4().hex}.mp4'
    target.parent.mkdir(parents=True, exist_ok=True)
    for old in sorted(target.parent.glob('*.mp4'), key=lambda path: path.stat().st_mtime)[:-20]:
        old.unlink(missing_ok=True)  # Keep the latest few.

    def run(should_cancel):
        render_timeline(parsed, media_facts, resolve_audio_asset, target, lambda progress: update_job(job_id, progress=progress), should_cancel, draft=True,
                        prepared=lambda media_id, steady, backwards, portrait: prepared_copy(media_id, steady, backwards, portrait, should_cancel),
                        masks=lambda facts, pick: instance_service.ensure_mask(facts, instance_service.from_choice(pick), should_cancel), window=(start, end))
        return {'progress': 100, 'path': str(target), 'start': start, 'end': end}

    job_id = enqueue_render('look', f"Look: {row['name']}", run, total=100)
    return {'job_id': job_id}


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
    from app.services.source_graphics import missing_sources
    return {'job_id': job_id,'source_warnings':missing_sources(parsed.model_dump(by_alias=True))}


@router.post('/projects/{identifier}/export-short')
def export_short(identifier: int, body: dict, hardware: str = 'true'):
    """A vertical Short (9:16) of `start` to `end` of this timeline, usually its chorus, saved as a new video. The project stays as it is."""
    from app.services.face_service import MODEL_NAME
    from app.services.focus_service import cached_focus
    from app.services.shorts import make_short
    row = project_for(identifier)
    try:
        parsed = Timeline.model_validate(body.get('timeline'))
        start, end = float(body['start']), float(body['end'])
    except (ValidationError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'This timeline is not valid.') from exc
    faces = (settings.model_cache_dir / 'face' / MODEL_NAME).is_file()  # Never downloaded for this; the subject finder needs nothing.

    def focus(facts, at):
        try:
            found = cached_focus(str(facts.path), facts.media_type, int(facts.width or 1920), int(facts.height or 1080), round(at, 2), facts.path.stat().st_mtime, faces)
        except Exception:
            return None  # Centred, as before.
        return (found['x'], found['y']) if found['x'] is not None else None

    try:
        short = make_short(parsed, start, end, media_facts, focus, look=bool(body.get('look')))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    target = settings.edit_workspace_dir / f'{uuid.uuid4().hex}.mp4'
    try:
        check_disk_space(target.parent, short.duration)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    def run(should_cancel):
        try:
            render_timeline(short, media_facts, resolve_audio_asset, target, lambda progress: update_job(job_id, progress=progress), should_cancel, prepared=lambda media_id, steady, backwards, portrait: prepared_copy(media_id, steady, backwards, portrait, should_cancel), masks=lambda facts, pick: instance_service.ensure_mask(facts, instance_service.from_choice(pick), should_cancel), voices=lambda path: voice_service.ensure_clean(path, should_cancel), hardware=hardware != 'false')
            output = index_media(target, f"{row['name']} — Short.mp4", exported=True)
            return {'progress': 100, 'output_photo_id': output['id']}
        except Exception:
            target.unlink(missing_ok=True)
            raise

    job_id = enqueue_render('video_export', f"Short: {row['name']}", run, total=100)
    return {'job_id': job_id, 'start': start, 'end': min(end, start + short.duration)}


@router.get('/photos/{identifier}/screen-colour')
def photo_screen_colour(identifier: int, at: float = 0.0):
    """The green or blue screen behind this clip, if it was shot on one; null means use the AI cut-out instead."""
    from PIL import Image
    from app.services.graphic_outline import _picture
    from app.services.screen_colour import screen_colour
    row = get_media(identifier)
    item = dict(row) if row else None
    if not item:
        raise HTTPException(404, 'That picture or video is not in the library.')
    try:
        return {'colour': screen_colour(Image.open(_picture(item, at)))}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/timeline/colour-match')
def colour_match(request: dict):
    """Gains that bring a keyed or cut-out clip toward the colour and light behind it, measured at `at`."""
    from app.services.composite_match import measure
    try:
        parsed = Timeline.model_validate(request.get('timeline'))
        clip_id, at = str(request.get('clip_id')), float(request.get('at', 0))
    except (ValidationError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'This timeline is not valid.') from exc
    render = lambda timeline, target, window: render_timeline(timeline, media_facts, resolve_audio_asset, target, lambda _: None, prepared=lambda media_id, steady, backwards, portrait: prepared_copy(media_id, steady, backwards, portrait, lambda: False), masks=lambda facts, pick: instance_service.ensure_mask(facts, instance_service.from_choice(pick), lambda: False), hardware=False, window=window)
    try:
        return {'gain': measure(parsed, clip_id, at, render)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get('/photos/{identifier}/focus')
def photo_focus(identifier: int, at: float = 0.0):
    """Where the main faces are in a photo, or in a video at `at` seconds, so a push-in aims at them. x and y are null when there are none."""
    from app.services.face_service import MODEL_NAME
    from app.services.focus_service import cached_focus
    # The face finder is fetched once by Blur faces; moves never download it, and aim at the picture's subject without it.
    model = (settings.model_cache_dir / 'face' / MODEL_NAME).is_file()
    row = get_media(identifier)
    path = Path(row['absolute_path'])
    if not path.is_file():
        raise HTTPException(404, f"{row['filename']} is no longer readable.")
    try:
        found = cached_focus(str(path), row['media_type'], int(row['width'] or 1920), int(row['height'] or 1080), round(max(0.0, at), 2), path.stat().st_mtime, model)
        return found if model else {**found, 'model': False}
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


@router.post('/photos/{identifier}/depth-motion')
def start_depth_motion(identifier: int, body: dict):
    """A picture as a 3D moving video (`seconds` long, `move`: push, pull, drift, drift-left, rise, sink, sweep, crane or glide-back): the camera glides through the scene.
    The job's result is the new video's `output_photo_id`. Ready at once when it was made before."""
    from app.services import depth_motion_service
    item = get_media(identifier)
    if item['media_type'] != 'image':
        raise HTTPException(400, '3D motion works on pictures.')
    if not depth_motion_service.available():
        raise HTTPException(400, '3D pictures need the depth model, which is not on this Mac.')
    try:
        seconds, move = float(body.get('seconds', 5)), str(body.get('move', 'push'))
        if not (0.5 <= seconds <= 120) or move not in depth_motion_service.MOVES:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose 0.5 to 120 seconds and one of the 3D moves.') from exc
    picture = Path(item['absolute_path'])

    def find(target: Path):
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None

    target = depth_motion_service.video_path(picture, seconds, move)
    if target.is_file() and find(target):
        return {'status': 'ready', 'output_photo_id': find(target)}

    def run(should_cancel):
        made = depth_motion_service.make(picture, seconds, move, lambda progress: update_job(job_id, progress=progress), should_cancel)
        existing = find(made)
        name = f"{Path(item['filename']).stem} 3D.mp4"
        return {'progress': 100, 'output_photo_id': existing or index_media(made, name, folder=item['folder'])['id']}  # Beside its picture

    job_id = enqueue_render('depth_motion', f"Making {item['filename']} 3D", run, total=100)
    return {'status': 'preparing', 'job_id': job_id}


@router.post('/brand-intro')
def start_brand_intro(body: dict):
    """The brand intro for a logo (a transparent picture in the library): a golden leaf falls among music notes, strikes
    them, the note appears in it and the logo forms, with `tamil` and `english` lines beneath (வழங்கும் / PRESENTS by
    default). `width` and `height` are the video's size. Ready at once when made before, else a job whose result has
    the intro's `media_id`."""
    from app.services import brand_intro_service
    try:
        logo = get_media(int(body['logo_media_id']))
        width, height = int(body.get('width', 1920)), int(body.get('height', 1080))
        if not (240 <= min(width, height) and max(width, height) <= 3840):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, 'Choose a logo, and a size between 240 and 3840.') from exc
    if logo['media_type'] != 'image':
        raise HTTPException(400, 'The brand intro is made from a logo picture.')
    tamil = str(body.get('tamil', brand_intro_service.DEFAULT_TAMIL))[:40]
    english = str(body.get('english', brand_intro_service.DEFAULT_ENGLISH))[:40]
    path = Path(logo['absolute_path'])

    def find(target: Path):
        with get_connection() as conn:
            row = conn.execute('SELECT id FROM photos WHERE absolute_path = ?', (str(target.resolve()),)).fetchone()
        return row[0] if row else None

    target = brand_intro_service.intro_path(path, width, height, tamil, english)
    if target.is_file() and find(target):
        return {'status': 'ready', 'media_id': find(target)}

    def run(should_cancel):
        try:
            made = brand_intro_service.make(path, width, height, tamil, english, lambda progress: update_job(job_id, progress=progress), should_cancel)
        except ValueError as exc:
            raise RuntimeError(str(exc)) from exc
        return {'progress': 100, 'media_id': find(made) or index_media(made, f"{Path(logo['filename']).stem} intro.mp4")['id']}

    job_id = enqueue_render('brand_intro', f"Brand intro from {logo['filename']}", run, total=100)
    return {'status': 'preparing', 'job_id': job_id}
