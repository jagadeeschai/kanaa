"""Place cached sentences using measured WAV durations, never estimated speaking times."""
import copy
import uuid
from app.services.timeline_schema import Timeline

def add_narration(timeline,lines,start,gap=.15,replace_id=None):
    if start<0 or not 0<=gap<=2: raise ValueError('Use a start at or after zero and a gap of 0–2 seconds.')
    after=copy.deepcopy(timeline); audio=[];captions=[];sentences=[];at=start; uid=lambda:uuid.uuid4().hex[:12]
    if replace_id:
        old=next((item for layer in after['layers'] if layer['kind']=='audio' and layer.get('name')=='Narration' for item in layer['items'] if item['id']==replace_id),None)
        if old is None or len(lines)!=1:raise ValueError('Select one narration sentence to redo it.')
        start=at=old['start'];end=start+(old['out']-old.get('in',0))/old.get('speed',1);delta=lines[0]['duration']-(end-start)
        for layer in after['layers']:
            if layer.get('name')!='Narration':continue
            layer['items']=[item for item in layer['items'] if item['id']!=replace_id and not item['id'].startswith(f'narration-{replace_id}')]
            for item in layer['items']:
                if item['start']>=end-1e-8:item['start']+=delta
    for line in lines:
        duration=line['duration']
        sound_id=uid()
        audio.append({'id':sound_id,'asset_id':line['asset_id'],'start':at,'in':0,'out':duration,'speed':1,'volume':1,'muted':False,'fade_in':0,'fade_out':0,'duck':False,'name':line['text'][:80],'source_length':duration})
        if line['words']:
            # Caption schema accepts at most 30 words. Chunk at actual provider word boundaries.
            for i in range(0,len(line['words']),30):
                chunk=line['words'][i:i+30];begin=0 if i==0 else chunk[0]['s']; end=line['words'][i+30]['s'] if i+30<len(line['words']) else duration
                captions.append({'id':f'narration-{sound_id}-{i}','start':at+begin,'length':end-begin,'words':[{'w':w['w'],'s':max(0,w['s']-begin)} for w in chunk]})
        else: sentences.append({'id':f'narration-{sound_id}','start':at,'length':duration,'text':line['text'],'style':'band','position':'bottom','size':38,'color':'#ffffff','tamil_font':'Arima'})
        at+=duration+gap
    # Only background music belongs to the ducked bus; narration is the sidechain signal.
    for layer in after['layers']:
        if layer['kind']=='audio' and layer.get('name') not in ('Narration','Documentary sounds'):
            for sound in layer['items']: sound['duck']=True
    after['layers'].append({'id':uid(),'kind':'audio','name':'Narration','items':audio})
    if captions:after['layers'].append({'id':uid(),'kind':'captions','name':'Narration','style':'band','size':48,'shared_images':True,'items':captions})
    if sentences:after['layers'].append({'id':uid(),'kind':'text','name':'Narration','items':sentences})
    Timeline.model_validate(after)
    return after
