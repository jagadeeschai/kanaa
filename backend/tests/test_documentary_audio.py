import unittest
from app.services.documentary_audio import pause_before,shift_narration,decorate
from app.services.timeline_schema import Timeline

def sample():
    return {'version':2,'format':{'width':426,'height':240,'fps':24},'layers':[
        {'id':'main','kind':'video','items':[{'id':'picture','media_id':1,'start':0,'in':0,'out':8}]},
        {'id':'voice','kind':'audio','name':'Narration','items':[{'id':'sentence','asset_id':'a'*32,'start':2,'in':0,'out':4,'duck':False}]},
        {'id':'music','kind':'audio','items':[{'id':'song','asset_id':'b'*32,'start':0,'in':0,'out':8,'duck':True}]},
        {'id':'graphics','kind':'text','items':[{'id':'number','start':4,'length':2,'text':'Number','graphic':{'kind':'count-up','from':[.5,.5],'to':[.5,.5]}}]}]}

class DocumentaryAudio(unittest.TestCase):
    def test_pause_preserves_audio_content_and_holds_picture(self):
        data=pause_before(sample(),'number',.5);layers=data['layers']
        voice=layers[1]['items'];self.assertEqual(sum(item['out']-item.get('in',0) for item in voice),4)
        self.assertEqual(voice[0]['start']+voice[0]['out'],4);self.assertEqual(voice[1]['start'],4.5)
        self.assertEqual(layers[3]['items'][0]['start'],4.5)
        hold=layers[0]['items'][1];self.assertTrue(hold['muted']);self.assertIn('freeze',hold)
        self.assertEqual(hold['out'],.5);Timeline.model_validate(data)

    def test_j_and_l_cuts_move_narration_only(self):
        data=shift_narration(sample(),'picture',-.4)
        self.assertEqual(data['layers'][1]['items'][0]['start'],1.6)
        self.assertEqual(data['layers'][0]['items'][0]['start'],0)
        self.assertEqual(shift_narration(sample(),'picture',.5)['layers'][1]['items'][0]['start'],2.5)

    def test_automatic_whooshes_are_soft_and_idempotent(self):
        data=sample();data['documentary_sound']={'enabled':True,'asset_id':'c'*32,'duration':.9,'peak':.5}
        data['layers'][-1]['items'][0]['graphic'].update(width=.7,height=.5)
        model=Timeline.model_validate(data);once=decorate(model);twice=decorate(once)
        self.assertEqual(len(once.layers),len(twice.layers));sound=once.layers[-1].items[0]
        self.assertEqual(sound.start,3.5);self.assertEqual(sound.volume,.18)
