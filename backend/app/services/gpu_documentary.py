"""Caption PNG states and a single cached freeze frame, composited by the existing GPU engine."""
import subprocess
from pathlib import Path
from app.services.timeline_schema import Text
from app.services.media_probe import MediaFacts

def caption(item,layer,fmt,folder,name):
    from app.services.timeline_service import caption_states,render_text_image
    from app.services.gpu_render import _frames
    if item.position:layer=layer.model_copy(update={'position':item.position})
    text=Text(id=item.id,start=item.start,length=item.length,text=item.text)
    states=caption_states(item,bool(layer.highlight));paths=[]
    for i,(_,_,lit) in enumerate(states):
        target=folder/f'{name}-{i}.png';render_text_image(text,fmt,target,layer=layer,lit=lit);paths.append(str(target))
    frames=max(1,round(item.length*fmt.fps));shown=[max(0,sum(start<=k/fmt.fps+1e-8 for start,_,_ in states)-1) for k in range(frames)]
    return {'kind':'image','path':paths[0],'paths':paths,'shown':shown,'start':round(item.start*fmt.fps),'frames':frames,'source_in':0,'speed':1,**_frames(text.transform,None,None,item.length,frames,fmt.fps)}

def frozen(clip,facts,fmt,folder,name):
    if clip.freeze is None or facts.media_type=='image':return facts
    import shutil
    from app.services.timeline_service import color_filter
    target=folder/f'{name}-freeze.png'
    result=subprocess.run([shutil.which('ffmpeg') or 'ffmpeg','-v','error','-ss',f'{max(0,clip.freeze-.25/fmt.fps):.6f}','-i',str(facts.path),'-vf',color_filter(facts)+',scale=in_color_matrix=bt709:out_range=full,format=rgb24','-frames:v','1','-update','1',str(target)],capture_output=True)
    if result.returncode or not target.is_file():raise RuntimeError('Could not prepare the paused picture for the GPU.')
    return MediaFacts(path=target,media_type='image',width=facts.width,height=facts.height)
