import json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image
from app.services.split_transition import panels
from app.services.timeline_schema import Timeline,Transition
from app.services import gpu_render
from app.services.media_probe import MediaFacts
from app.services.timeline_service import render_timeline

def timeline(n=2,direction='horizontal',style='clean'):
    return Timeline.model_validate({'format':{'width':426,'height':240,'fps':24},'layers':[{'id':'main','kind':'video','items':[
        {'id':'a','media_id':1,'start':0,'in':0,'out':1},
        {'id':'b','media_id':2,'start':1,'in':0,'out':1,'transition_in':{'kind':'split','duration':.6,'split_panels':n,'split_direction':direction,'split_style':style}}]}]})

class SplitMath(unittest.TestCase):
    def test_defaults_and_endpoints(self):
        self.assertEqual((Transition(kind='split').split_panels,Transition(kind='split').split_direction,Transition(kind='split').split_style),(2,'horizontal','clean'))
        for n in (2,3,4):
            for direction in ('horizontal','vertical','diagonal'):
                for p in panels(0,n,direction,426,240):self.assertEqual(p['move'],[0,0,1,0])
                for p in panels(1,n,direction,426,240):
                    x,y,w,h=p['rect'];dx,dy,alpha,_=p['move']
                    self.assertTrue(x+dx+w<=0 or x+dx>=426 or y+dy+h<=0 or y+dy>=240)
                self.assertEqual(gpu_render.unsupported(timeline(n,direction),lambda _:MediaFacts(path=Path('x.png'),media_type='image',width=426,height=240)),[])

    def test_shared_sample(self):
        self.assertEqual(panels(.25,3,'diagonal',426,240,'gap'),[
            {'rect':[0,0,142,240],'move':[-66,-38,1,2]},
            {'rect':[142,0,142,240],'move':[0,-38,.84375,2]},
            {'rect':[284,0,142,240],'move':[66,38,1,2]}])

@unittest.skipUnless(sys.platform=='darwin' and shutil.which('swiftc'),'needs Metal')
class SplitGPU(unittest.TestCase):
    def test_panels_directions_and_styles_match_reference(self):
        from app.services.cutout_service import helper
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);w,h=426,240;y,x=np.mgrid[:h,:w]
            a=np.stack([x*255//w,y*255//h,100+40*np.sin(x/25)],2).astype(np.uint8)
            b=np.stack([240-y*150//h,200-x*160//w,80+y*160//h],2).astype(np.uint8)
            for i,picture in enumerate((a,b),1):Image.fromarray(picture).save(root/f'{i}.png')
            facts={i:MediaFacts(path=root/f'{i}.png',media_type='image',width=w,height=h) for i in (1,2)}
            with patch('app.services.cutout_service.settings') as settings:settings.data_dir=root;tool=helper(gpu_render.SOURCE)
            read=lambda path:np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-f','rawvideo','-pix_fmt','rgb24','-']),np.uint8).reshape(-1,h,w,3).astype(float)
            scores=[]
            for n in (2,3,4):
                for direction in ('horizontal','vertical','diagonal'):
                    for style in ('clean','gap','shadow'):
                        name=f'{n}-{direction}-{style}';cpu=root/(name+'-cpu.mp4');gpu=root/(name+'-gpu.mp4');work=timeline(n,direction,style)
                        render_timeline(work,facts.__getitem__,lambda _:None,cpu,lambda _:None,hardware=False)
                        gpu_render.render(work,facts.__getitem__,gpu,tool=tool)
                        aa,bb=read(cpu),read(gpu);self.assertEqual(aa.shape,bb.shape)
                        db=10*np.log10(255**2/np.maximum(((aa-bb)**2).mean(axis=(1,2,3)),1e-10));worst=float(db.min());average=float(db.mean())
                        print('split',name,round(worst,2),round(average,2),'frame',int(db.argmin()),flush=True);scores.append({'panels':n,'direction':direction,'style':style,'worst_db':worst,'average_db':average})
                        if os.getenv('KANAA_SPLIT_PROOF'):
                            out=Path(os.environ['KANAA_SPLIT_PROOF']);out.mkdir(exist_ok=True,parents=True)
                            Image.fromarray(bb[24].astype(np.uint8)).save(out/(name+'.png'));Image.fromarray(aa[int(db.argmin())].astype(np.uint8)).save(out/(name+'-cpu-worst.png'));Image.fromarray(bb[int(db.argmin())].astype(np.uint8)).save(out/(name+'-gpu-worst.png')); (out/'scores.json').write_text(json.dumps(scores,indent=2))
                        self.assertGreaterEqual(worst,35,name)
