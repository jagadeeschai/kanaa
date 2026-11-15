import unittest
import numpy as np
from app.services.title_glint import glint_face
from app.services.timeline_schema import Timeline,Transition
from app.services.animation import xfade_name
from app.services.gpu_render import _transition,unsupported
class CinematicFinish(unittest.TestCase):
 def test_glint_adds_real_light_and_changes_over_time(self):
  crop=np.zeros((90,160,4),np.float32)
  a=glint_face(crop,(0,0),(30,20,130,70),0)
  b=glint_face(crop,(0,0),(30,20,130,70),.65)
  self.assertGreater(float(a[...,3].sum()),1);self.assertGreater(float(b[...,3].sum()),float(a[...,3].sum())*2)
  self.assertTrue((b[...,:3]<=b[...,3:4]+1e-6).all())
 def test_wipe_has_an_export_expression_and_gpu_plan(self):
  transition=Transition(kind='light-wipe',duration=.6)
  self.assertIn('custom:expr=',xfade_name(transition));self.assertIn('X/W',xfade_name(transition))
  self.assertEqual(_transition(transition,18,360)['kind'],'light-wipe')
