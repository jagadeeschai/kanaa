from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,Field
from typing import Literal
from app.services.timeline_schema import Timeline
from app.services.documentary_audio import shift_narration,pause_before
from app.services.sound_effect_service import use

router=APIRouter()
@router.post('/documentary/source-check')
def source_check(body:dict):
    from app.services.source_graphics import missing_sources
    try:timeline=Timeline.model_validate(body)
    except ValueError:raise HTTPException(400,'This timeline is not valid.') from None
    return {'missing_sources':missing_sources(timeline.model_dump(by_alias=True))}

class Edit(BaseModel):
    timeline:dict
    action:Literal['lead','trail','pause','sounds']
    item_id:str=''
    seconds:float=Field(default=.4,ge=.1,le=3,allow_inf_nan=False)
    enabled:bool=True

@router.post('/documentary/edit')
def edit(body:Edit):
    try:
        Timeline.model_validate(body.timeline)
        if body.action=='pause':return pause_before(body.timeline,body.item_id,body.seconds)
        if body.action in ('lead','trail'):return shift_narration(body.timeline,body.item_id,body.seconds*(-1 if body.action=='lead' else 1))
        effect=use('kanaa-whoosh')
        return {**body.timeline,'documentary_sound':{'enabled':body.enabled,**{k:effect[k] for k in ('asset_id','duration','peak')}}}
    except ValueError as exc:raise HTTPException(400,str(exc)) from None
