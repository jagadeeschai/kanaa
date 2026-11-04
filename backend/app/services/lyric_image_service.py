import asyncio
import base64
import io
import json
import threading
import uuid
from pathlib import Path
from typing import Literal

import httpx
from PIL import Image
from pydantic import BaseModel, Field
from app.api.schemas import LyricCue
from app.core.config import settings
from app.db.database import get_connection
from app.services.ai_settings_service import read_settings
from app.services.job_service import JobCancelled, update_job
from app.services.media_service import index_media
from app.services.render_queue_service import enqueue_render

STYLES = {
    'cinematic': 'Cinematic photographic stills, expressive natural light, a restrained harmonious color palette, film-like depth.',
    'watercolor': 'Luminous watercolor paintings, soft paper texture, gentle washes, expressive atmosphere.',
    'illustration': 'Refined editorial illustration, intentional shapes, subtle texture, a cohesive limited palette.',
    'dreamlike': 'Dreamlike surreal imagery, poetic visual metaphors, soft ethereal lighting, atmospheric depth.',
    'photographic': 'Natural documentary photography, authentic environments, believable detail, warm soft light.',
}
generation_lock = threading.Lock()
SIZES = {'portrait': '1024x1536', 'square': '1024x1024', 'landscape': '1536x1024'}
STORY_BEATS = (
    'an establishing image that introduces the place and recurring subject',
    'the recurring subject moving deeper into the same world',
    'an intimate detail or quiet emotional moment with the recurring subject',
    'a visual turning point that raises the emotion while preserving continuity',
    'a calm resolution in the same world with the recurring subject',
)


class ScenePlan(BaseModel):
    lyrics: str = Field(min_length=1, max_length=30000)
    cues: list[LyricCue] = Field(default_factory=list, max_length=500)
    count: int = Field(default=4, ge=1, le=8)
    style: Literal['cinematic', 'watercolor', 'illustration', 'dreamlike', 'photographic'] = 'cinematic'
    brief: str = Field(default='', max_length=1500)
    canvas: Literal['portrait', 'square', 'landscape'] = 'portrait'
    purpose: Literal['scenes', 'cover'] = 'scenes'


class SceneEdit(BaseModel):
    id: int
    prompt: str = Field(min_length=1, max_length=12000)


class GenerateScenes(BaseModel):
    batch_id: str
    scenes: list[SceneEdit] = Field(min_length=1, max_length=8)
    quality: Literal['low', 'medium', 'high'] = 'medium'


def require_project(identifier):
    with get_connection() as conn:
        project = conn.execute('SELECT kind FROM projects WHERE id=?', (identifier,)).fetchone()
    if project is None or project['kind'] not in {'lyric', 'edit'}:
        raise ValueError('Choose an existing video project.')


def require_english_visual_prompt(value, label='visual brief'):
    text = value.strip()
    if not text:
        raise ValueError(f'Add an English {label} before building scenes.')
    if not any('a' <= character.lower() <= 'z' for character in text) or any(ord(character) > 127 for character in text):
        raise ValueError(f'Write the {label} in English. Lyrics stay separate and are not used as image prompts.')
    return text


def current_batch(identifier, batch_id=None):
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM image_batches WHERE project_id=?' + (' AND id=?' if batch_id else '') + ' ORDER BY rowid DESC LIMIT 1', (identifier, batch_id) if batch_id else (identifier,)).fetchone()
        if row is None: return None
        batch = dict(row)
        batch['scenes'] = [dict(scene) for scene in conn.execute('SELECT * FROM image_scenes WHERE batch_id=? ORDER BY position', (row['id'],)).fetchall()]
        job = conn.execute('SELECT status FROM render_jobs WHERE id=?', (row['job_id'],)).fetchone() if row['job_id'] else None
    batch['active'] = bool(job and job['status'] in {'queued', 'running', 'cancelling'})
    return batch


def plan_scenes(identifier, plan):
    with generation_lock:
        return _plan_scenes(identifier, plan)


def _plan_scenes(identifier, plan):
    require_project(identifier)
    previous = current_batch(identifier)
    if previous and previous['active']:
        raise ValueError('Wait for the current images to finish, or cancel them first.')
    lines = [line.strip() for line in plan.lyrics.splitlines() if line.strip()]
    if not lines or len(lines) > 500 or any(len(line) > 500 for line in lines):
        raise ValueError('Use 1–500 lyric lines, with up to 500 characters per line.')
    brief = require_english_visual_prompt(plan.brief)
    # Timings only attach when the supplied cues still describe these exact lyrics.
    timed = len(plan.cues) == len(lines) and all(cue.text.strip() == line for cue, line in zip(plan.cues, lines)) and all(plan.cues[index].start >= plan.cues[index - 1].end for index in range(1, len(plan.cues)))
    count = min(plan.count, len(lines))
    batch_id = uuid.uuid4().hex
    with get_connection() as conn:
        conn.execute('INSERT INTO image_batches(id,project_id,lyrics,style,brief,canvas) VALUES(?,?,?,?,?,?)', (batch_id, identifier, plan.lyrics, plan.style, plan.brief, plan.canvas))
        for index in range(count):
            first, end = index * len(lines) // count, (index + 1) * len(lines) // count
            excerpt = '\n'.join(lines[first:end])
            beat = STORY_BEATS[min(len(STORY_BEATS) - 1, index * len(STORY_BEATS) // count)]
            prompt = ((f'Create one polished cover artwork for a video. English visual brief: {brief}. '
                       'Use one clear focal subject, a memorable silhouette, and a calm title-safe area. '
                       f'Visual style: {STYLES[plan.style]} No words, captions, logos, or watermarks. '
                       f'Use a visually complete {plan.canvas} composition with generous crop-safe margins.') if plan.purpose == 'cover' else
                      (f'Create scene {index + 1} of {count} for one visually continuous music video. '
                      f'English visual brief and continuity bible: {brief}. '
                      'Continuity is mandatory: keep the same recurring people with the same facial features, age, hair, skin tone, and wardrobe; '
                      'keep the same location design, time of day, weather, color palette, lighting direction, lens language, and image treatment in every scene. '
                      'Do not introduce a new main character or redesign a recurring subject unless the visual brief explicitly asks for it. '
                      f'This scene is {beat}. '
                      f'Visual style shared across the entire video: {STYLES[plan.style]} '
                      'Keep the lower fifth calm and uncluttered for lyric overlays. No words, captions, logos, or watermarks. '
                      f'Use a visually complete {plan.canvas} composition with centered focal subjects and generous crop-safe margins. Follow the continuity bible exactly.'))
            conn.execute('INSERT INTO image_scenes(batch_id,position,lyric,prompt,start,end) VALUES(?,?,?,?,?,?)',
                         (batch_id, index, excerpt, prompt, plan.cues[first].start if timed else None, plan.cues[end - 1].end if timed else None))
        conn.commit()
    return current_batch(identifier, batch_id)


async def request_image(config, prompt, size, quality, should_cancel):
    async with httpx.AsyncClient(timeout=httpx.Timeout(240, connect=20), follow_redirects=False) as client:
        request = asyncio.create_task(client.post(config['base_url'] + '/images/generations',
            headers={'Authorization': 'Bearer ' + config['api_key']},
            json={'model': config['model'], 'prompt': prompt, 'size': size, 'quality': quality, 'n': 1, 'output_format': 'png'}))
        try:
            while not request.done():
                if should_cancel(): raise JobCancelled()
                await asyncio.sleep(.15)
            response = await request
        finally:
            if not request.done():
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)
    if response.status_code in {401, 403}:
        raise ValueError('The image provider rejected access. Check the API key and model permissions in AI settings.')
    if response.status_code == 429:
        raise ValueError('The provider limit was reached. Check credits or wait, then retry the failed scene.')
    if response.status_code >= 400:
        # Never expose provider response bodies: they can contain credentials or private inputs.
        raise ValueError(f'The image provider could not generate this scene (HTTP {response.status_code}). Review the prompt or model, then retry.')
    try:
        encoded = response.json()['data'][0]['b64_json']
        if not isinstance(encoded, str) or len(encoded) > 50 * 1024 * 1024:
            raise ValueError()
        contents = base64.b64decode(encoded, validate=True)
        with Image.open(io.BytesIO(contents)) as image:
            if image.width * image.height > 40_000_000: raise ValueError()
            image.load()
            output = io.BytesIO(); image.convert('RGB').save(output, 'PNG')
            return output.getvalue()
    except (ValueError, KeyError, IndexError, TypeError, OSError) as exc:
        raise ValueError('The provider returned no readable base64 image. Check that it supports the OpenAI image-generation API.') from exc


def start_generation(identifier, request):
    with generation_lock:
        return _start_generation(identifier, request)


def _start_generation(identifier, request):
    require_project(identifier)
    config = read_settings()
    if not config['api_key']:
        raise ValueError('Add an API key in AI settings before generating images.')
    batch = current_batch(identifier, request.batch_id)
    if not batch: raise ValueError('Scene plan not found. Build scene prompts first.')
    if current_batch(identifier)['id'] != batch['id']: raise ValueError('This scene plan was replaced. Reopen the current plan.')
    if batch['active']: raise ValueError('This scene batch is already generating.')
    available = {scene['id']: scene for scene in batch['scenes']}
    ids = [scene.id for scene in request.scenes]
    if len(set(ids)) != len(ids) or any(identifier not in available for identifier in ids):
        raise ValueError('Choose scenes from this project’s current plan.')
    if any(available[identifier]['status'] == 'done' for identifier in ids):
        raise ValueError('These scenes are already generated. Retry unfinished scenes or make a new plan.')
    for scene in request.scenes:
        require_english_visual_prompt(scene.prompt, 'scene prompt')
    ready = threading.Event()
    with get_connection() as conn:
        for scene in request.scenes:
            conn.execute("UPDATE image_scenes SET prompt=?,status='queued',error=NULL WHERE id=?", (scene.prompt.strip(), scene.id))
        conn.commit()

    def run(should_cancel):
        ready.wait()
        successes = []
        failures = 0
        try:
            for index, scene in enumerate(request.scenes):
                if should_cancel(): raise JobCancelled()
                with get_connection() as conn:
                    conn.execute("UPDATE image_scenes SET status='running' WHERE id=?", (scene.id,)); conn.commit()
                update_job(job_id, phase=f'Generating scene {available[scene.id]["position"] + 1}', progress=round(index / len(ids) * 100))
                path = settings.data_dir / 'media' / f'ai-{uuid.uuid4().hex}.png'
                indexed = False
                try:
                    image = asyncio.run(request_image(config, scene.prompt, SIZES[batch['canvas']], request.quality, should_cancel))
                    if should_cancel(): raise JobCancelled()
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(image)
                    media = index_media(path, f'AI scene {available[scene.id]["position"] + 1}.png')
                    indexed = True
                    with get_connection() as conn:
                        conn.execute("UPDATE image_scenes SET media_id=?,status='done',error=NULL WHERE id=?", (media['id'], scene.id)); conn.commit()
                    successes.append(media['id'])
                except JobCancelled:
                    path.unlink(missing_ok=True)
                    raise
                except Exception as exc:
                    if not indexed: path.unlink(missing_ok=True)
                    failures += 1
                    message = str(exc) if isinstance(exc, ValueError) else 'Image generation failed. Check the provider connection and retry this scene.'
                    with get_connection() as conn:
                        conn.execute("UPDATE image_scenes SET status='failed',error=? WHERE id=?", (message, scene.id)); conn.commit()
            warning = f'{failures} scene(s) failed. Completed images are saved; retry only failed scenes.' if failures else None
            if not successes and failures:
                raise ValueError('No images were generated. Review the scene errors and AI settings, then retry.')
            return {'progress': 100, 'warning': warning, 'generated_photo_ids': successes}
        finally:
            with get_connection() as conn:
                conn.execute("UPDATE image_scenes SET status='cancelled',error='Stopped before this scene completed.' WHERE batch_id=? AND status IN ('running','queued')", (batch['id'],)); conn.commit()

    job_id = enqueue_render('lyric_images', f'Lyric images · {len(ids)} scenes', run, total=100)
    with get_connection() as conn:
        conn.execute('UPDATE image_batches SET job_id=? WHERE id=?', (job_id, batch['id'])); conn.commit()
    ready.set()
    return {'job_id': job_id}


def recover_scene_jobs():
    with get_connection() as conn:
        conn.execute("UPDATE image_scenes SET status='failed',error='Interrupted by a server restart. Retry this scene.' WHERE status IN ('queued','running')")
        conn.commit()


def save_scene_prompts(identifier, batch_id, scenes):
    with generation_lock:
        require_project(identifier)
        batch = current_batch(identifier, batch_id)
        if not batch or batch['active']:
            raise ValueError('This scene plan is unavailable or generating.')
        available = {scene['id']: scene for scene in batch['scenes']}
        if any(scene.id not in available or available[scene.id]['status'] == 'done' or not scene.prompt.strip() for scene in scenes):
            raise ValueError('Only unfinished scene prompts can be edited.')
        for scene in scenes:
            require_english_visual_prompt(scene.prompt, 'scene prompt')
        with get_connection() as conn:
            for scene in scenes:
                conn.execute('UPDATE image_scenes SET prompt=? WHERE id=?', (scene.prompt.strip(), scene.id))
            conn.commit()
        return {'success': True}
