from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
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
from app.services import edit_plan_service, text_ai_service  # noqa: E402


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
