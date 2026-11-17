import io
import json
import os
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.services import narration_service as voice
from app.services.narration_timeline import add_narration
from app.api.voice_routes import router

def recording(seconds=1.37):
    out=io.BytesIO()
    with wave.open(out,'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(b'\0\0'*round(seconds*24000))
    return out.getvalue()

class Narration(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.patch=patch.object(voice,'settings',SimpleNamespace(data_dir=self.root));self.patch.start();self.addCleanup(self.patch.stop)
        self.api=Mock();self.api.synthesize_speech.return_value=SimpleNamespace(audio_content=recording(),timepoints=[SimpleNamespace(mark_name='w0',time_seconds=.03),SimpleNamespace(mark_name='w1',time_seconds=.65)])
        self.pclient=patch.object(voice,'client',return_value=self.api);self.pclient.start();self.addCleanup(self.pclient.stop)
        self.name='ta-IN-Wavenet-A'

    def generate(self,script='முதல் சொல்.',voice_name=None):
        name=voice_name or self.name;price=voice.estimate(script,name)
        return voice.generate(script,name,1,0,price['quote'],price['usd'])

    def test_word_marks_escape_ssml_and_audio_duration_drives_captions(self):
        lines=self.generate('முதல் &சொல்.')
        request=self.api.synthesize_speech.call_args.kwargs['request']
        self.assertIn('&amp;',request['input']['ssml']);self.assertEqual(request['enable_time_pointing'],['SSML_MARK'])
        self.assertIsNone(self.api.synthesize_speech.call_args.kwargs['retry'])
        self.assertEqual(lines[0]['duration'],1.37)
        timeline={'version':2,'format':{'width':1920,'height':1080,'fps':30},'layers':[{'id':'main','kind':'video','items':[]}]}
        result=add_narration(timeline,lines,2)
        audio=result['layers'][1]['items'][0];caption=result['layers'][2]['items'][0]
        self.assertLessEqual(abs(audio['start']-caption['start']),1/30)
        self.assertLessEqual(abs(audio['start']+audio['out']-caption['start']-caption['length']),1/30)
        self.assertEqual([w['s'] for w in caption['words']],[.03,.65])
        self.assertEqual(timeline['layers'][0]['items'],[])

    def test_chirp_uses_sentence_caption_and_never_switches_voice(self):
        lines=self.generate('தமிழ் உரை.', 'ta-IN-Chirp3-HD-Aoede')
        request=self.api.synthesize_speech.call_args.kwargs['request']
        self.assertEqual(request['voice']['name'],'ta-IN-Chirp3-HD-Aoede');self.assertNotIn('enable_time_pointing',request)
        self.assertEqual(lines[0]['caption_timing'],'audio-sentence')
        base={'version':2,'format':{'width':1920,'height':1080,'fps':30},'layers':[{'id':'main','kind':'video','items':[]}]}
        result=add_narration(base,lines,0)
        self.assertEqual(result['layers'][-1]['kind'],'text');self.assertEqual(result['layers'][-1]['items'][0]['length'],1.37)

    def test_redo_one_sentence_moves_later_narration_and_ducks_music(self):
        lines=self.generate('முதல் சொல்.\nஇரண்டாம் சொல்.')
        base={'version':2,'format':{'width':1920,'height':1080,'fps':30},'layers':[{'id':'main','kind':'video','items':[]}, {'id':'music','kind':'audio','items':[{'id':'song','asset_id':'a'*32,'start':0,'in':0,'out':10,'duck':False}]}]}
        before=add_narration(base,lines,0);audio=before['layers'][-2]['items'];old=audio[0];second=audio[1]['start']
        redo={**lines[0],'duration':2}
        after=add_narration(before,[redo],0,replace_id=old['id'])
        remaining=[item for layer in after['layers'] if layer['kind']=='audio' and layer.get('name')=='Narration' for item in layer['items']]
        self.assertEqual(len(remaining),2)
        self.assertAlmostEqual(next(item['start'] for item in remaining if item['id']==audio[1]['id']),second+.63)
        self.assertTrue(after['layers'][1]['items'][0]['duck'])

    def test_cache_survives_missing_metadata_and_prevents_second_charge(self):
        lines=self.generate();self.generate();self.assertEqual(self.api.synthesize_speech.call_count,1)
        (self.root/'voice'/(lines[0]['asset_id']+'.json')).unlink()
        self.generate();self.assertEqual(self.api.synthesize_speech.call_count,1)
        self.assertEqual(voice.estimate('முதல் சொல்.',self.name)['usd'],0)

    def test_cost_quote_required_and_prices_include_billable_markup(self):
        price=voice.estimate('Hello world.',self.name)
        self.assertGreater(price['usd'],len('Hello world.')*4/1e6)
        with self.assertRaisesRegex(ValueError,'estimate'):voice.generate('Hello world.',self.name,1,0,'bad',1)
        with self.assertRaisesRegex(ValueError,'estimate'):voice.generate('Hello world.',self.name,1,0,price['quote'],0)
        self.api.synthesize_speech.assert_not_called()

    def test_live_catalog_sorted_without_hardcoded_voice_names(self):
        self.api.list_voices.side_effect=[SimpleNamespace(voices=[SimpleNamespace(name='ta-IN-Wavenet-Z',language_codes=['ta-IN']),SimpleNamespace(name='ta-IN-Chirp3-HD-Future',language_codes=['ta-IN'])]),SimpleNamespace(voices=[SimpleNamespace(name='en-IN-Neural2-X',language_codes=['en-IN'])])]
        found=voice.voices();self.assertEqual(found[0]['name'],'ta-IN-Chirp3-HD-Future');self.assertEqual(found[-1]['language'],'en-IN')

    def test_key_is_private_and_rejects_other_auth_endpoints(self):
        key={'type':'service_account','client_email':'kanaa@example.iam.gserviceaccount.com','private_key':'-----BEGIN PRIVATE KEY-----\nTEST\n','token_uri':'https://oauth2.googleapis.com/token'}
        self.assertEqual(voice.save_key(json.dumps(key).encode()),{'configured':True})
        self.assertEqual(voice.key_path().stat().st_mode & 0o777,0o600)
        key['token_uri']='https://example.com/steal'
        with self.assertRaises(ValueError):voice.save_key(json.dumps(key).encode())
        self.assertNotIn('TEST',json.dumps(voice.configured()))

    def test_plain_errors_include_google_console_but_never_raw_inputs(self):
        error=voice.provider_error(Exception('BILLING_DISABLED secret script https://console.cloud.google.com/billing/enable?project=test'))
        self.assertIn('billing is off',str(error));self.assertIn('https://console.cloud.google.com',str(error));self.assertNotIn('secret script',str(error))
        self.assertIn('API is disabled',str(voice.provider_error(Exception('SERVICE_DISABLED'))))

    def test_api_generation_and_uncharged_failures(self):
        app=FastAPI();app.include_router(router,prefix='/api');api=TestClient(app)
        body={'script':'முதல் சொல்.','voice':self.name}
        price=api.post('/api/voice/estimate',json=body).json()
        reply=api.post('/api/voice/generate',json={**body,'quote':price['quote'],'max_cost':price['usd']})
        self.assertEqual(reply.status_code,200);self.assertEqual(reply.json()['lines'][0]['duration'],1.37)
        self.assertEqual(api.post('/api/voice/estimate',json={**body,'script':'x'*501}).status_code,400)

    def test_preview_caption_route_uses_shared_export_picture_and_separate_cache(self):
        from app.api import timeline_routes
        from app.services.timeline_schema import Text,Format,CaptionLayer
        from app.services.timeline_service import render_text_image
        from PIL import Image,ImageChops
        fmt=Format(width=426,height=240,fps=24)
        layer=CaptionLayer(id='look',kind='captions',items=[],shared_images=True,size=48,style='band')
        caption={'id':'line','start':0,'length':1,'text':'தமிழில் ஒரு விளக்கம்.'}
        body={'caption':{k:v for k,v in caption.items() if k!='text'},'layer':layer.model_dump(),'format':fmt.model_dump(),'lit':None}
        body['caption']['words']=[{'w':word,'s':0} for word in caption['text'].split()]
        expected=self.root/'expected.png'
        render_text_image(Text(**caption),fmt,expected,layer=layer,lit=None)
        with patch.object(timeline_routes,'settings',SimpleNamespace(data_dir=self.root)):
            actual=timeline_routes.caption_image(body)
            legacy=timeline_routes.caption_image({**body,'layer':{**body['layer'],'shared_images':False}})
        self.assertNotEqual(actual.path,legacy.path)
        self.assertIsNone(ImageChops.difference(Image.open(actual.path),Image.open(expected)).getbbox())

class LiveVoice(unittest.TestCase):
    @unittest.skipUnless(os.getenv('KANAA_LIVE_VOICE_TEST')=='1' and voice.key_path().is_file(),'optional: requires explicit opt-in and Kanaa’s configured key')
    def test_live_voice_catalog_only_no_synthesis_charge(self):
        self.assertTrue(voice.voices())
