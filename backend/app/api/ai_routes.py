from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.ai_settings_service import public_settings, save_settings
from app.services.lyric_image_service import ScenePlan, GenerateScenes, current_batch, plan_scenes, start_generation, require_project, save_scene_prompts, SceneEdit

router = APIRouter()


class AISettingsUpdate(BaseModel):
    api_key: str | None = Field(default=None, max_length=500)
    base_url: str = Field(default='https://api.openai.com/v1', max_length=500)
    model: str = Field(default='gpt-image-2.5-flare', min_length=1, max_length=100)
    clear_key: bool = False


@router.get('/ai-settings')
def get_settings():
    return public_settings()


@router.put('/ai-settings')
def update_settings(data: AISettingsUpdate):
    try:
        return save_settings(data.api_key, data.base_url, data.model, data.clear_key)
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
