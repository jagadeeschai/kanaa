import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from app.services.timeline_schema import Text,Format
from app.services.map_graphics import projection,bounds,render_map
from kanaa_mcp.graphics import graphic_item
from test_sequence_graphics import compare_gpu

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
