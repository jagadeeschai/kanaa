import json
import tempfile
import unittest
import os,subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from app.services.timeline_schema import Text,Format
from app.services.map_graphics import projection,bounds,render_map
from kanaa_mcp.graphics import graphic_item
from test_sequence_graphics import compare_gpu
from app.services.source_graphics import source_item,catalog,decorate,missing_sources

def source_note():return Text.model_validate(source_item('source','ஆதாரம்: ஆய்வு அறிக்கை, 2026 — example.org',0,1.5))
def source_roll():
    item=source_item('roll','ஆதாரங்கள் — ஆய்வு அறிக்கை, 2026',0,1.5,.5)
    item['transform']={'keyframes':{'y':[{'t':0,'v':1.1},{'t':1.5,'v':-.1}]}}
    return Text.model_validate(item)

def map_item():
    return Text.model_validate(graphic_item('map',0,1.5,(.5,.5),.5625,settings={'width':.9,'height':.8,'style':'clean'}))

def fake_maps(folder):
    maps=folder/'maps';maps.mkdir()
    def feature(name,ring):return {'type':'Feature','properties':{'ADMIN':name},'geometry':{'type':'Polygon','coordinates':[ring]}}
    # Deliberately small synthetic shapes for deterministic tests. Proof exports use the installed real outlines.
    (maps/'countries.geojson').write_text(json.dumps({'type':'FeatureCollection','features':[feature('India',[[68,24],[75,35],[88,27],[96,28],[88,21],[80,8],[74,15],[68,24]])]}))
    (maps/'states.geojson').write_text(json.dumps({'type':'FeatureCollection','features':[feature('Tamil Nadu',[[77,8],[80,10],[80.4,13.5],[77,12],[77,8]])]}))

class DocumentaryGraphics(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);fake_maps(self.root)
        self.config=patch('app.services.map_graphics.settings',SimpleNamespace(data_dir=self.root));self.config.start();self.addCleanup(self.config.stop)

    def test_map_coordinates_and_zoom_are_exact(self):
        self.assertEqual(projection(0,0),(.5,.5))
        graphic=map_item().graphic;start=bounds(graphic,0);end=bounds(graphic,1)
        self.assertLess(end[2]-end[0],start[2]-start[0]);self.assertLess(end[3]-end[1],start[3]-start[1])
        for place in graphic.map_places:
            x,y=projection(place.lon,place.lat);self.assertTrue(end[0]<x<end[2]);self.assertTrue(end[1]<y<end[3])

    def test_sources_deduplicate_attach_and_rebuild_roll_without_length_drift(self):
        from app.services.timeline_schema import Timeline
        item=map_item().model_dump(by_alias=True);item['source']='Natural Earth (public domain)'
        number={**item,'id':'number','start':2,'graphic':{'kind':'count-up','from':[.5,.5],'to':[.5,.5]},'source':None}
        data={'format':{'width':426,'height':240,'fps':24},'layers':[{'id':'graphics','kind':'text','items':[item,number]}],'sources_roll':True}
        self.assertEqual(catalog(data),['Natural Earth (public domain)']);self.assertEqual(missing_sources(data)[0]['id'],'number')
        timeline=Timeline.model_validate(data);once=decorate(timeline);twice=decorate(once)
        self.assertEqual(timeline.duration,10.3);self.assertEqual(once.duration,twice.duration)
        self.assertEqual(len(once.layers),len(twice.layers));self.assertEqual(once.layers[1].items[0].start,item['start'])

    def test_source_note_and_roll_stay_on_gpu_and_match_ffmpeg(self):
        for make in (source_note,source_roll):
            worst,average=compare_gpu(make,'documentary');print(make.__name__,'GPU dB:',round(worst,2),round(average,2));self.assertGreaterEqual(worst,35)

    def test_word_captions_and_a_real_video_freeze_match_on_gpu(self):
        from app.services.timeline_schema import Timeline
        from app.services.timeline_service import render_timeline
        from app.services import gpu_render
        from app.services.cutout_service import helper
        from app.services.media_probe import probe_video
        width,height=426,240
        with tempfile.TemporaryDirectory() as temporary,patch.dict(os.environ,{'KANAA_GPU_RENDER':'0'}):
            root=Path(temporary);base=root/'base.mp4'
            # Full-range moving RGB gradient, encoded as a real BT.709 video. The existing native renderer's
            # chroma sampling on testsrc's fine saturated checkerboards is a separate baseline limitation.
            source=f"color=black:s={width}x{height}:r=24:d=2,format=rgb24,geq=r='255*X/W':g='255*Y/H':b='128+100*sin(2*PI*T)'"
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',source,'-vf','scale=out_color_matrix=bt709','-c:v','libx264','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',str(base)],check=True)
            facts=probe_video(base)
            timeline=Timeline.model_validate({'format':{'width':width,'height':height,'fps':24},'layers':[
                {'id':'main','kind':'video','items':[{'id':'freeze','media_id':1,'start':0,'in':0,'out':1.5,'freeze':.5}]},
                {'id':'captions','kind':'captions','style':'band','shared_images':True,'items':[{'id':'words','start':0,'length':1.5,'words':[{'w':'தமிழ்','s':0},{'w':'உரை','s':.5},{'w':'விளக்கம்','s':1}]}]}]})
            self.assertEqual(gpu_render.unsupported(timeline,lambda _:facts),[])
            cpu=root/'cpu.mp4';gpu=root/'gpu.mp4';render_timeline(timeline,lambda _:facts,lambda _:None,cpu,lambda _:None,hardware=False)
            with patch('app.services.cutout_service.settings') as settings:
                settings.data_dir=root;tool=helper(gpu_render.SOURCE)
            gpu_render.render(timeline,lambda _:facts,gpu,tool=tool)
            def read(path):return np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,check=True).stdout,np.uint8).reshape(-1,height,width,3)
            a,b=read(cpu),read(gpu);mse=((a.astype(float)-b)**2).mean(axis=(1,2,3));db=10*np.log10(255**2/np.maximum(mse,1e-10))
            if os.getenv('KANAA_GRAPHICS_PROOF'):
                from PIL import Image
                folder=Path(os.environ['KANAA_GRAPHICS_PROOF']);folder.mkdir(parents=True,exist_ok=True);index=int(db.argmin())
                Image.fromarray(a[index]).save(folder/'caption-cpu.png');Image.fromarray(b[index]).save(folder/'caption-gpu.png');Image.fromarray(np.minimum(255,abs(a[index].astype(int)-b[index])*8).astype(np.uint8)).save(folder/'caption-difference.png')
            print('captions + freeze GPU dB:',db.min(),db.mean());self.assertGreaterEqual(float(db.min()),35)

    def test_map_schema_rejects_invalid_places(self):
        data=map_item().model_dump(by_alias=True)
        for places in ([],[{'name':'x','lat':91,'lon':0}],[{'name':'x','lat':0,'lon':float('nan')}]):
            data['graphic']['map_places']=places
            with self.assertRaises(ValueError):Text.model_validate(data)

    def test_map_ink_stays_inside_its_box_at_all_sizes(self):
        for width,height in ((426,240),(1280,720),(1920,1080)):
            item=map_item();image=np.asarray(render_map(item,Format(width=width,height=height,fps=24),1));ys,xs=np.nonzero(image[:,:,3])
            self.assertGreater(len(xs),100)
            self.assertGreaterEqual(xs.min(),round(width*.05)-1);self.assertLessEqual(xs.max(),round(width*.95)+1)
            self.assertGreaterEqual(ys.min(),round(height*.1)-1);self.assertLessEqual(ys.max(),round(height*.9)+1)

    def test_gpu_map_matches_ffmpeg_in_every_style(self):
        for style in ('clean','documentary','dark-band','bold-colour'):
            with self.subTest(style=style):
                worst,average=compare_gpu(map_item,style);print('map',style,'GPU dB:',round(worst,2),round(average,2));self.assertGreaterEqual(worst,35)
