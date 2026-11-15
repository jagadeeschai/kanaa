import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from pydantic import ValidationError
from app.services.timeline_schema import Text, TitleDepth
from app.services.title_material import MATERIALS, material_face, sweep_at
from app.services.title3d_render import _drawer, frame_at, alpha_box
from app.services import title3d

class TitleMaterials(unittest.TestCase):
    def picture(self):
        image=Image.new('RGBA',(160,90)); ImageDraw.Draw(image).rectangle((40,30,120,60),fill='white')
        return np.asarray(image,dtype=np.float32)/255

    def test_materials_change_real_pixels_and_keep_premultiplied_alpha(self):
        crop=self.picture()
        for material in MATERIALS:
            depth=TitleDepth(material=material,bevel=.8,shine=.7)
            got=material_face(crop,depth,(0,0),(36,26,125,65),-2)
            self.assertTrue(np.isfinite(got).all(),material)
            self.assertGreater(np.abs(got-crop).sum(),100,material)
            self.assertTrue((got[...,:3]<=got[...,3:4]+1e-6).all(),material)
            self.assertLessEqual(float(got.max()),1)
        glass=material_face(crop,TitleDepth(material='glass'),(0,0),(36,26,125,65),-2)
        self.assertAlmostEqual(float(glass[45,80,3]),.38,places=5)
        neon=material_face(crop,TitleDepth(material='neon'),(0,0),(36,26,125,65),-2)
        self.assertGreater(float(neon[29,80,3]),0)
        stone=material_face(crop,TitleDepth(material='stone'),(0,0),(36,26,125,65),-2)
        self.assertGreater(float(stone[61,80,3]),0)

    def test_legacy_face_is_identical_and_schema_bounds(self):
        crop=self.picture()
        np.testing.assert_array_equal(crop,material_face(crop,TitleDepth(),(0,0),(0,0,160,90),0))
        for raw in ({'material':'wood'},{'bevel':1.1},{'shine':-1}):
            with self.assertRaises(ValidationError):TitleDepth(**raw)

    def test_sweep_is_after_entrance_and_still_cache_waits_for_it(self):
        text=Text(id='x',start=0,length=4,text='HI',depth=TitleDepth(material='gold',sweep=True),enter={'preset':'fade','duration':1})
        self.assertEqual(sweep_at(text,.9),-2)
        self.assertAlmostEqual(sweep_at(text,1.45),.5)
        self.assertEqual(sweep_at(text,2),-2)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'title.png';Image.fromarray((self.picture()*255).astype('uint8')).save(path)
            draw=_drawer(text,path,(160,90),30,120,None,None)
            self.assertIsNone(draw(40)[0]); self.assertIsNone(draw(50)[0])
            self.assertEqual(draw(70)[0],draw(90)[0]); np.testing.assert_array_equal(draw(70)[1],draw(90)[1])

    def test_face_material_keeps_the_3d_path_at_zero_depth(self):
        text=Text(id='z',start=0,length=2,text='A',depth=TitleDepth(amount=0,material='gold'))
        self.assertTrue(title3d.is_3d(text))
