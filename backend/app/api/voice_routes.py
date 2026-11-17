from fastapi import APIRouter,File,HTTPException,UploadFile
from pydantic import BaseModel,Field
from app.services import narration_service as voice_service
from app.services.narration_timeline import add_narration
import json,re

router=APIRouter()

class VoiceRequest(BaseModel):
    script:str=Field(min_length=1,max_length=30000)
    voice:str
    speed:float=Field(default=1,ge=.25,le=2,allow_inf_nan=False)
    pitch:float=Field(default=0,ge=-20,le=20,allow_inf_nan=False)
    quote:str=''
    max_cost:float=Field(default=0,ge=0,allow_inf_nan=False)
    preview:bool=False
    timeline:dict|None=None
    start:float=Field(default=0,ge=0,allow_inf_nan=False)
    gap:float=Field(default=.15,ge=0,le=2)
    replace_id:str|None=Field(default=None,max_length=64)

def checked(call):
    try:return call()
    except ValueError as exc:raise HTTPException(400,str(exc)) from None

@router.get('/voice/settings')
def status():return voice_service.configured()

@router.post('/voice/key')
async def key(file:UploadFile=File(...)):
    data=await file.read(65537)
    return checked(lambda:voice_service.save_key(data))

@router.delete('/voice/key')
def remove():return voice_service.remove_key()

@router.get('/voice/voices')
def voices():return checked(voice_service.voices)

@router.get('/voice/line/{asset_id}')
def line(asset_id:str):
    if not re.fullmatch(r'[a-f0-9]{32}',asset_id):raise HTTPException(404,'Narration sentence not found.')
    target=voice_service.settings.data_dir/'voice'/(asset_id+'.json')
    if not target.is_file():raise HTTPException(404,'Narration sentence not found.')
    return json.loads(target.read_text())

@router.post('/voice/estimate')
def estimate(body:VoiceRequest):return checked(lambda:voice_service.estimate(body.script,body.voice,body.speed,body.pitch))

@router.post('/voice/generate')
def generate(body:VoiceRequest):
    def run():
        if body.timeline is not None:
            from app.services.timeline_schema import Timeline
            try:Timeline.model_validate(body.timeline)
            except ValueError:raise ValueError('The timeline is not valid. No voice was generated.') from None
        if body.replace_id and (body.timeline is None or len(voice_service.sentences(body.script))!=1 or not any(layer['kind']=='audio' and layer.get('name')=='Narration' and any(item['id']==body.replace_id for item in layer['items']) for layer in body.timeline['layers'])):
            raise ValueError('Select one narration sentence to redo it. No voice was generated.')
        lines=voice_service.generate(body.script,body.voice,body.speed,body.pitch,body.quote,body.max_cost,body.preview)
        timeline=add_narration(body.timeline,lines,body.start,body.gap,body.replace_id) if body.timeline is not None and not body.preview else None
        if timeline is not None and timeline.get('documentary_sound') is None:
            from app.services.sound_effect_service import use
            effect=use('kanaa-whoosh');timeline['documentary_sound']={'enabled':True,**{k:effect[k] for k in ('asset_id','duration','peak')}}
        return {'lines':lines,'timeline':timeline}
    return checked(run)
