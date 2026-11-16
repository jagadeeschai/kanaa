import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image
from app.services.timeline_schema import Format, Text
from app.services.explainer_graphics import render, state_at, state_count
from app.services.step_graphics import render_steps, step_starts, step_states


def step_item():
    return Text.model_validate({'id': 'steps', 'start': 0, 'length': 3, 'text': 'Step list', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 44,
        'enter': {'preset': 'reveal', 'duration': 1.2}, 'graphic': {'kind': 'step-list', 'style': 'clean', 'from': [.5,.5], 'to': [.5,.5], 'width': .9, 'height': .9, 'line_width': .006,
        'steps': ['திட்டமிடுங்கள்', 'உருவாக்குங்கள்', 'பகிருங்கள்'], 'highlight_current': False}})


def timeline_item():
    data=step_item().model_dump(by_alias=True); data['id']='timeline'; data['text']='Timeline bar'
    data['graphic'].update(kind='timeline-bar',points=[{'date':'300 BCE','label':'சங்க காலம்'},{'date':'1947','label':'விடுதலை'},{'date':'இன்று','label':'புதிய தொடக்கம்'}])
    return Text.model_validate(data)


MAKERS = [step_item, timeline_item]
STYLES = ('clean', 'documentary', 'dark-band', 'bold-colour')


def compare_gpu(make, style, width=426, height=240, folder=None):
    from app.services import gpu_render
    from app.services.cutout_service import helper
    from app.services.media_probe import MediaFacts
    from app.services.timeline_schema import Timeline
    from app.services.timeline_service import render_timeline
    with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
        root = Path(folder or temporary); root.mkdir(parents=True, exist_ok=True); base = root / 'base.png'
        yy, xx = np.mgrid[:height, :width]
        Image.fromarray(np.stack([xx*255//width, yy*255//height, np.full_like(xx,140)],2).astype(np.uint8)).save(base)
        facts = {1: MediaFacts(path=base, media_type='image', width=width, height=height)}
        item = make().model_dump(by_alias=True); item['graphic']['style'] = style; item['length'] = 1.5
        timeline = Timeline.model_validate({'format': {'width':width,'height':height,'fps':24}, 'layers': [
            {'id':'main','kind':'video','items':[{'id':'base','media_id':1,'start':0,'in':0,'out':1.5}]},
            {'id':'graphics','kind':'text','name':'Graphics','items':[item]}]})
        if gpu_render.unsupported(timeline, facts.__getitem__): raise AssertionError('Graphic left GPU path')
        cpu = root/'cpu.mp4'; render_timeline(timeline, facts.__getitem__, lambda _:None, cpu, lambda _:None, hardware=False)
        if not (sys.platform == 'darwin' and shutil.which('swiftc')): raise unittest.SkipTest('Metal requires Mac')
        with patch('app.services.cutout_service.settings') as settings:
            settings.data_dir = root; tool = helper(gpu_render.SOURCE)
        gpu = root/'gpu.mp4'; gpu_render.render(timeline, facts.__getitem__, gpu, tool=tool)
        def read(path):
            return np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,check=True).stdout,np.uint8).reshape(-1,height,width,3)
        cpu_frames, gpu_frames = read(cpu), read(gpu)
        mse = ((cpu_frames.astype(float)-gpu_frames)**2).mean(axis=(1,2,3)); psnr = 10*np.log10(255**2/np.maximum(mse,1e-10))
        if psnr.min() < 35 and folder:
            i = int(psnr.argmin()); Image.fromarray(np.minimum(255,abs(cpu_frames[i].astype(int)-gpu_frames[i])*8).astype(np.uint8)).save(root/'difference.png')
        return float(psnr.min()), float(psnr.mean())


class SequenceGraphics(unittest.TestCase):
    def test_timeline_marker_hits_each_point_exactly_when_label_appears(self):
        from app.services.timeline_graphics import marker, point_times, timeline_states, render_timeline_bar
        item=timeline_item(); times=point_times(item); states=timeline_states(item,24)
        fmt=Format(width=426,height=240,fps=24)
        for i,at in enumerate(times):
            self.assertEqual(marker(item,at),i/(len(times)-1))
            self.assertIn(at,states); self.assertEqual(state_at(item,at),states.index(at))
            if i:
                before=np.asarray(render_timeline_bar(item,fmt,state_at(item,at-1e-6)/(len(states)-1)))
                after=np.asarray(render_timeline_bar(item,fmt,state_at(item,at)/(len(states)-1)))
                # New text adds opaque pixels away from the marker's horizontal line.
                self.assertGreater(np.count_nonzero(after[:105,:,3])+np.count_nonzero(after[135:,:,3]),np.count_nonzero(before[:105,:,3])+np.count_nonzero(before[135:,:,3]))

    def test_eight_long_tamil_timeline_points_stay_inside_own_box(self):
        from app.services.timeline_graphics import render_timeline_bar
        from app.services.chart_graphics import _fit,least
        item=timeline_item(); item.graphic.points=[item.graphic.points[0].model_copy(update={'date':'மிகநீளமானசங்ககாலத்தேதி','label':'தமிழ்நாட்டின் மிக நீளமான வரலாற்று விளக்கப்பெயர்'}) for _ in range(8)]
        for width,height in ((426,240),(1280,720),(1920,1080)):
            for vertical in (False,True):
                item.graphic.timeline_vertical=vertical; fmt=Format(width=width,height=height,fps=24); sizes=[]
                def fitted(*args,**kwargs):
                    result=_fit(*args,**kwargs); sizes.append(result[0].size); return result
                with patch('app.services.timeline_graphics._fit',side_effect=fitted),patch('app.services.step_graphics._fit',side_effect=fitted): image=render_timeline_bar(item,fmt,1)
                ys,xs=np.nonzero(np.asarray(image)[:,:,3]>0)
                with self.subTest(width=width,vertical=vertical):
                    self.assertGreaterEqual(min(sizes),least(fmt)*2)
                    self.assertGreaterEqual(xs.min(),int(width*.05)-1); self.assertLessEqual(xs.max(),int(width*.95)+1)
                    self.assertGreaterEqual(ys.min(),int(height*.05)-1); self.assertLessEqual(ys.max(),int(height*.95)+1)

    def test_step_validation_and_times_inside_clip(self):
        for changes in ({'steps':['one']}, {'step_times':[.3,.2]}, {'step_times':[0,1,3]}, {'step_times':[float('nan')]}):
            data = step_item().model_dump(by_alias=True); data['graphic'].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError): Text.model_validate(data)

    def test_exact_event_states_and_real_pixels_before_and_after(self):
        item = step_item(); item.graphic.step_times = [.25,.75,1.25]; fmt=Format(width=426,height=240,fps=24)
        for index, at in enumerate(item.graphic.step_times):
            states=step_states(item,24); self.assertIn(at,states)
            before=render_steps(item,fmt,state_at(item,at-1e-6)/(len(states)-1))
            after=render_steps(item,fmt,state_at(item,at+1e-6)/(len(states)-1))
            top=round(.05*240)+5; row=(216-10)/3; y0=round(top+index*row); y1=round(top+(index+1)*row)
            self.assertEqual(np.asarray(before)[y0:y1,:,3].max(),0)
            self.assertGreater(np.asarray(after)[y0:y1,:,3].max(),0)
            self.assertEqual(state_at(item,at),states.index(at))

    def test_eight_long_tamil_steps_inside_own_box_and_readable(self):
        item=step_item(); item.graphic.steps=['தமிழ்நாட்டின் மிக நீளமான வரலாற்று விளக்கப் படிநிலை இதுவாகும்']*8
        for width,height in ((426,240),(1280,720),(1920,1080)):
            fmt=Format(width=width,height=height,fps=24)
            from app.services.chart_graphics import _fit, least
            sizes=[]
            def fitted(*args,**kwargs):
                result=_fit(*args,**kwargs); sizes.append(result[0].size); return result
            with patch('app.services.step_graphics._fit',side_effect=fitted): image=render_steps(item,fmt,1)
            ys,xs=np.nonzero(np.asarray(image)[:,:,3]>0)
            self.assertGreater(len(xs),100); self.assertGreaterEqual(min(sizes),least(fmt)*2)
            self.assertGreaterEqual(xs.min(),int(width*.05)-1); self.assertLessEqual(xs.max(),int(width*.95)+1)
            self.assertGreaterEqual(ys.min(),int(height*.05)-1); self.assertLessEqual(ys.max(),int(height*.95)+1)

    @unittest.skipUnless(shutil.which('ffmpeg'),'ffmpeg required')
    def test_gpu_export_matches_ffmpeg_for_every_graphic_and_style(self):
        for make in MAKERS:
            for style in STYLES:
                with self.subTest(kind=make.__name__,style=style):
                    worst,average=compare_gpu(make,style)
                    print(make.__name__,style,'GPU vs ffmpeg dB:',round(worst,2),round(average,2))
                    self.assertGreaterEqual(worst,35)
