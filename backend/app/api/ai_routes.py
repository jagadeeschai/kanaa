from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services import text_ai_service
from app.services.ai_settings_service import public_settings, save_settings
from app.services.lyric_image_service import ScenePlan, GenerateScenes, current_batch, plan_scenes, start_generation, require_project, save_scene_prompts, SceneEdit

router = APIRouter()


class AISettingsUpdate(BaseModel):
    api_key: str | None = Field(default=None, max_length=500)
    base_url: str = Field(default='https://api.openai.com/v1', max_length=500)
    model: str = Field(default='gpt-image-2.5-flare', min_length=1, max_length=100)
    text_model: str | None = Field(default=None, max_length=120)  # For Ask AI; None keeps the saved one.
    clear_key: bool = False


@router.get('/ai-settings')
def get_settings():
    return public_settings()


@router.put('/ai-settings')
def update_settings(data: AISettingsUpdate):
    try:
        return save_settings(data.api_key, data.base_url, data.model, data.clear_key, data.text_model)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get('/projects/{identifier}/image-scenes')
def get_scenes(identifier: int):
    try:
        require_project(identifier)
        return {'batch': current_batch(identifier)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/projects/{identifier}/image-scenes/plan')
def build_scenes(identifier: int, data: ScenePlan):
    try:
        return plan_scenes(identifier, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/projects/{identifier}/image-scenes/direct')
def direct_scenes(identifier: int, data: ScenePlan):
    """The lyric director: the text model reads the lyrics and plans the scenes; the plan is saved like a hand-built one."""
    from app.services.lyric_director_service import direct
    lines = [line.strip() for line in data.lyrics.splitlines() if line.strip()]
    if not lines:
        raise HTTPException(400, 'Paste the lyrics first.')
    try:
        require_project(identifier)
        direction = direct(lines[:500], data.count, data.style, data.canvas, data.brief)
    except text_ai_service.NotConfigured as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:  # Network trouble: say so plainly.
        raise HTTPException(502, f'Could not reach the AI provider: {exc.__class__.__name__}.') from exc
    try:
        return plan_scenes(identifier, data, direction)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/projects/{identifier}/image-scenes/generate')
def generate(identifier: int, data: GenerateScenes):
    try:
        return start_generation(identifier, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class ScenePromptsUpdate(BaseModel):
    scenes: list[SceneEdit] = Field(min_length=1, max_length=8)


@router.patch('/projects/{identifier}/image-scenes/{batch_id}')
def update_prompts(identifier: int, batch_id: str, data: ScenePromptsUpdate):
    try:
        return save_scene_prompts(identifier, batch_id, data.scenes)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# ---- The AI connection for words: Ask AI, caption translation, post words. ----

from typing import Any, Literal  # noqa: E402
from app.services import edit_plan_service  # noqa: E402


class PlanRequest(BaseModel):
    request: str = Field(min_length=1, max_length=1000)
    project: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, list[dict[str, str]]] = Field(default_factory=dict)


class TranslateRequest(BaseModel):
    lines: list[str] = Field(min_length=1, max_length=400)
    to: Literal['ta', 'en']


class DescribeRequest(BaseModel):
    project: dict[str, Any] = Field(default_factory=dict)
    language: Literal['ta', 'en', 'both'] = 'en'


def _ai(work):
    try:
        return work()
    except text_ai_service.NotConfigured as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:  # Network trouble: say so plainly.
        raise HTTPException(502, f'Could not reach the AI provider: {exc.__class__.__name__}.') from exc


@router.post('/ai/plan')
def plan_edits(data: PlanRequest):
    return _ai(lambda: edit_plan_service.plan(data.request, data.project, data.options))


@router.post('/ai/translate')
def translate_lines(data: TranslateRequest):
    return _ai(lambda: {'lines': edit_plan_service.translate([line[:500] for line in data.lines], data.to)})


@router.post('/ai/describe')
def describe_video(data: DescribeRequest):
    return _ai(lambda: edit_plan_service.describe(data.project, data.language))


class AIEditRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1500)
    quality: Literal['low', 'medium', 'high'] = 'medium'


@router.post('/photos/{identifier}/ai-edit')
def ai_edit(identifier: int, data: AIEditRequest):
    """Edit with AI: one job that redraws the picture from the request; its result names the new picture."""
    from app.services.ai_image_edit import start_edit
    try:
        return {'job_id': start_edit(identifier, data.prompt, data.quality)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class VideoAISettingsUpdate(BaseModel):
    provider: Literal['atlas', 'openai'] = 'atlas'
    base_url: str = Field(max_length=500)
    model: str = Field(min_length=1, max_length=120)
    resolution: Literal['480p', '720p', '1080p'] = '720p'
    text_model: str | None = Field(default=None, max_length=120)
    api_key: str | None = Field(default=None, max_length=500)
    clear_key: bool = False


@router.get('/video-ai-settings')
def get_video_settings():
    from app.services.ai_video import public_settings as video_public
    return video_public()


@router.put('/video-ai-settings')
def update_video_settings(data: VideoAISettingsUpdate):
    from app.services.ai_video import save_settings as video_save
    try:
        return video_save(data.provider, data.base_url, data.model, data.resolution, data.api_key, data.clear_key, data.text_model)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class BringToLifeRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1500)
    seconds: int = Field(default=5, ge=5, le=15)


@router.post('/photos/{identifier}/bring-to-life')
def bring_to_life(identifier: int, data: BringToLifeRequest):
    """One job that makes the picture a few seconds of video; its result names the new video."""
    from app.services.ai_video import start
    try:
        return {'job_id': start(identifier, data.prompt, data.seconds)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class TextToVideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    seconds: int = Field(default=5, ge=5, le=15)
    shape: Literal['landscape', 'portrait', 'square'] = 'landscape'
    folder: str | None = Field(default=None, max_length=200)


@router.post('/ai-video/from-text')
def video_from_text(data: TextToVideoRequest):
    """Text-to-video: one job that makes a scene from words; its result names the new video."""
    from app.services.ai_video import start_text
    try:
        return {'job_id': start_text(data.prompt, data.seconds, data.shape, data.folder)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class RemovePeopleRequest(BaseModel):
    people: list[int] = Field(min_length=1, max_length=6)
    quality: Literal['low', 'medium', 'high'] = 'medium'
    method: Literal['local', 'ai'] = 'local'  # On this Mac (LaMa), or the image provider.
    kind: Literal['people', 'objects', 'clicks'] = 'people'


@router.post('/photos/{identifier}/people')
def find_people_in_picture(identifier: int, kind: Literal['people', 'objects'] = 'people'):
    """Remove person, step 1: each person in the picture, numbered, with a preview to choose from."""
    from app.services.remove_person import find_people
    from app.services.local_fill import available
    try:
        from app.services.click_select import available as can_click
        return {**find_people(identifier, kind=kind), 'local': available(), 'click': can_click()}
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get('/photos/{identifier}/people/preview')
def people_preview(identifier: int, kind: Literal['people', 'objects', 'clicks'] = 'people'):
    from fastapi.responses import FileResponse
    from app.services.remove_person import preview_path
    path = preview_path(identifier, kind)
    if not path.exists():
        raise HTTPException(404, 'Look for the people first.')
    return FileResponse(path, media_type='image/jpeg', headers={'Cache-Control': 'no-store'})


@router.post('/photos/{identifier}/remove-people')
def remove_people(identifier: int, data: RemovePeopleRequest):
    """Remove person, step 2: one job that fills where the chosen people were; its result names the new picture."""
    from app.services.remove_person import start_remove
    try:
        return {'job_id': start_remove(identifier, data.people, data.quality, data.method, data.kind)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class ClickPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    keep: bool = True


class OutlineRequest(BaseModel):
    points: list[ClickPoint] = Field(min_length=1, max_length=20)


@router.post('/photos/{identifier}/outline')
def outline_by_clicks(identifier: int, data: OutlineRequest):
    """Click to choose: outlines what was clicked (MobileSAM) as Remove's one choice; returns a tinted preview."""
    from app.services.click_select import available, outline
    if not available():
        raise HTTPException(409, 'Click to choose is not installed: run ./install-fill.sh in the Kanaa folder.')
    try:
        return outline(identifier, [point.model_dump() for point in data.points])
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class RefineEdit(BaseModel):
    x: float = Field(default=0, ge=0, le=1)
    y: float = Field(default=0, ge=0, le=1)
    add: bool = True
    stroke: list[tuple[float, float]] | None = Field(default=None, max_length=2000)  # A brush stroke, shares of the picture.
    radius: float = Field(default=0.02, gt=0, le=0.2)


class RefineStart(BaseModel):
    kind: Literal['people', 'objects']
    numbers: list[int] = Field(min_length=1, max_length=20)


class RefineRequest(BaseModel):
    start: RefineStart | None = None
    edits: list[RefineEdit] = Field(default_factory=list, max_length=200)


@router.post('/photos/{identifier}/refine')
def refine_selection(identifier: int, data: RefineRequest):
    """Fix the selection: from what was found (or nothing), each click adds or takes away the region it lands on."""
    from app.services.click_select import available, refine
    if not available():
        raise HTTPException(409, 'Fixing the selection needs Click to choose: run ./install-fill.sh in the Kanaa folder.')
    try:
        return refine(identifier, data.start.model_dump() if data.start else None, [edit.model_dump() for edit in data.edits])
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class PopoutRequest(BaseModel):
    people: list[int] = Field(min_length=1, max_length=6)
    kind: Literal['people', 'objects', 'clicks'] = 'people'


@router.post('/photos/{identifier}/popout')
def popout(identifier: int, data: PopoutRequest):
    """Pop-out (3D): one job that makes the cut-out and the filled background; its result names both pictures."""
    from app.services.popout import start
    try:
        return {'job_id': start(identifier, data.people, data.kind)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class GraphicOutlineRequest(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    at: float = Field(default=0, ge=0)


@router.post('/photos/{identifier}/graphic-outline')
def graphic_outline(identifier: int, data: GraphicOutlineRequest):
    """Glow outline: the edge of what is at (x, y) in the picture, or in the video `at` seconds in."""
    from app.services.graphic_outline import outline
    try:
        return outline(identifier, data.x, data.y, data.at)
    except LookupError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
