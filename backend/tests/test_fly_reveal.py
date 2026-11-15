import unittest
import numpy as np
from app.services.fly_reveal import state_at,overlay
from app.services.timeline_schema import Text,Timeline,Clip
from pydantic import ValidationError
from app.services import title3d,gpu_render
class FlyReveal(unittest.TestCase):
 def test_matte_cuts_only_layers_below_then_opens(self):
  text=Text(id='x',start=0,length=4,text='A',enter={'preset':'fly-reveal','duration':2},exit={'preset':'fly-through-3d','duration':1})
  frame=np.zeros((4,4,4),np.uint8);frame[1:3,1:3]=[255,200,30,255]
  masked=overlay(frame,frame,state_at(text,0))
  np.testing.assert_array_equal(masked[0,0],[0,0,0,255]);self.assertEqual(int(masked[1,1,3]),0)
  self.assertIsNone(state_at(text,2));self.assertIsNotNone(state_at(text,3.5))
  self.assertEqual(title3d.pose_at(text,0)[0]['size'],12)
  self.assertAlmostEqual(title3d.pose_at(text,2)[0]['size'],1)
 def test_gpu_draws_the_reveal(self):
  # Its frames are pictures (black outside the letters, clear inside), laid on like any 3D title.
  timeline=Timeline.model_validate({'layers':[{'id':'t','kind':'text','items':[{'id':'x','start':0,'length':3,'text':'A','enter':{'preset':'fly-reveal','duration':2}}]}]})
  self.assertEqual(gpu_render.unsupported(timeline,lambda _:None),[])

 def test_letter_mattes_are_title_only(self):
  with self.assertRaises(ValidationError):
   Clip.model_validate({'id':'x','media_id':1,'start':0,'in':0,'out':2,'enter':{'preset':'fly-reveal','duration':1}})
