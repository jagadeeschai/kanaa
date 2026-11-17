"""Shared documentary whooshes and non-destructive edits of narration/picture timing."""
import copy
import uuid
from app.services.timeline_schema import Timeline

def decorate(timeline):
    config=timeline.documentary_sound
    if not config or not config.enabled:return timeline
    data=timeline.model_dump(by_alias=True);data['layers']=[layer for layer in data['layers'] if not layer['id'].startswith('__doc_sound_')]
    times=sorted({item.start for layer in timeline.layers if layer.kind=='text' and not layer.hidden for item in layer.items if item.graphic and (item.graphic.kind=='chapter-card' or item.graphic.width*item.graphic.height>=.18)})
    for index,at in enumerate(times):
        begin=max(0,at-config.peak);cut=max(0,config.peak-at)
        data['layers'].append({'id':f'__doc_sound_layer_{index}','kind':'audio','name':'Documentary sounds','items':[{'id':f'__doc_sound_item_{index}','asset_id':config.asset_id,'start':begin,'in':cut,'out':config.duration,'volume':.18,'duck':False,'name':'Soft documentary whoosh','fade_in':.03,'fade_out':.15}]})
    return Timeline.model_validate(data)

def length(item):return item.get('length',(item.get('out',0)-item.get('in',0))/item.get('speed',1))

def shift_narration(timeline,clip_id,amount):
    data=copy.deepcopy(timeline);main=next(layer for layer in data['layers'] if layer['kind']=='video')
    clip=next((item for item in main['items'] if item['id']==clip_id),None)
    if clip is None:raise ValueError('Select a picture on the main track for a J or L cut.')
    begin,end=clip['start'],clip['start']+length(clip)
    affected={item['id'] for layer in data['layers'] if layer['kind']=='audio' and layer.get('name')=='Narration' for item in layer['items'] if begin-1e-8<=item['start']<end}
    found=False
    for layer in data['layers']:
        if layer.get('name')!='Narration':continue
        for item in layer['items']:
            if item['id'] in affected or any(item['id'].startswith(f'narration-{identifier}') for identifier in affected):
                if item['start']+amount<0:raise ValueError('Leave room before the picture for narration to lead it.')
                item['start']+=amount;found=True
    if not found:raise ValueError('Add narration at this picture first.')
    try:Timeline.model_validate(data)
    except ValueError:raise ValueError('Leave a larger gap between narration sentences before moving this cut.') from None
    return data

def pause_before(timeline,graphic_id,seconds):
    data=copy.deepcopy(timeline);target=next((item for layer in data['layers'] if layer['kind']=='text' for item in layer['items'] if item['id']==graphic_id and item.get('graphic',{}).get('kind')=='count-up'),None)
    if target is None:raise ValueError('Select a count-up number to pause before it.')
    if not .1<=seconds<=3:raise ValueError('Choose a pause of 0.1–3 seconds.')
    at=target['start'];uid=lambda:uuid.uuid4().hex[:12]
    for layer in data['layers']:
        items=[]
        for item in layer['items']:
            start=item['start'];end=start+length(item)
            if layer['kind']=='video' and start<at<=end+1e-8 and (item.get('ramp') or item.get('reverse') or item.get('transform',{}).get('keyframes')):
                raise ValueError('Make the pause on a straight, forward clip without position keyframes first.')
            if start>=at-1e-8:item['start']+=seconds;items.append(item);continue
            if end<=at+1e-8:
                items.append(item)
                if layer['kind']=='video' and abs(end-at)<1e-8:
                    hold=copy.deepcopy(item);hold.update(id=uid(),start=at,**{'in':0,'out':seconds,'speed':1,'freeze':item.get('freeze') if item.get('freeze') is not None else max(0,item['out']-1/timeline['format']['fps']),'muted':True,'enter':None,'exit':None,'transition_in':None});items.append(hold)
                continue
            if layer['kind'] in ('video','audio'):
                if item.get('ramp') or item.get('reverse') or item.get('transform',{}).get('keyframes'):
                    raise ValueError('Make the pause on a straight, forward clip without position keyframes first.')
                cut=item.get('in',0)+(at-start)*item.get('speed',1)
                tail=copy.deepcopy(item);tail.update(id=uid(),start=at+seconds,**{'in':cut,'fade_in':0});item.update(out=cut,fade_out=0)
                if layer['kind']=='video':
                    item['exit']=None;tail.update(enter=None,transition_in=None)
                    hold=copy.deepcopy(item);hold.update(id=uid(),start=at,**{'in':0,'out':seconds,'speed':1,'freeze':item.get('freeze') if item.get('freeze') is not None else max(0,cut-1/timeline['format']['fps']),'muted':True,'enter':None,'exit':None,'transition_in':None})
                    items.extend([item,hold,tail])
                else:items.extend([item,tail])
            else:
                item['length']+=seconds
                if layer['kind']=='captions':
                    for word in item['words']:
                        if word['s']>=at-start:word['s']+=seconds
                items.append(item)
        layer['items']=items
    Timeline.model_validate(data)
    return data
