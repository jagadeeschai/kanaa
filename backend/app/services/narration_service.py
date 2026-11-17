"""Google narration, with explicit credentials, cost quotes and durable per-sentence audio caches.

Never use ADC or another project's credentials. No provider error text (which can contain inputs) is exposed.
Pricing checked 2026-11-17: https://cloud.google.com/text-to-speech/pricing . Estimates exclude free allowances.
"""
from __future__ import annotations
import hashlib
import html
import json
import os
import re
import tempfile
import threading
import wave
from pathlib import Path
from app.core.config import settings

MISSING = 'Add a Google voice key in Settings → AI → Voice'
PRICES = {'Chirp3-HD':30, 'Neural2':16, 'Wavenet':4, 'Standard':4}  # USD per million billable characters.
_lock = threading.Lock()


def key_path(): return settings.data_dir / 'voice' / 'google-service-account.json'


def configured(): return {'configured':key_path().is_file()}


def atomic(path:Path,data:bytes):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix='.voice-',dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'wb') as output: output.write(data)
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)


def save_key(data:bytes):
    try:
        if len(data)>65536: raise ValueError()
        key=json.loads(data)
        if (key.get('type')!='service_account' or not key.get('client_email','').endswith('.gserviceaccount.com')
            or not str(key.get('private_key','')).startswith('-----BEGIN PRIVATE KEY-----')
            or key.get('token_uri')!='https://oauth2.googleapis.com/token'
            or key.get('universe_domain','googleapis.com')!='googleapis.com'): raise ValueError()
        # Keep only Google's expected fields, excluding injected endpoint overrides.
        allowed=('type','project_id','private_key_id','private_key','client_email','client_id','auth_uri','token_uri','auth_provider_x509_cert_url','client_x509_cert_url','universe_domain')
        atomic(key_path(),json.dumps({k:key[k] for k in allowed if k in key}).encode())
    except (ValueError,TypeError,KeyError):
        raise ValueError('Choose a Google service-account JSON key for Kanaa.') from None
    return configured()


def remove_key():
    key_path().unlink(missing_ok=True)
    return configured()


def client():
    if not key_path().is_file(): raise ValueError(MISSING)
    try:
        from google.cloud import texttospeech_v1beta1 as tts
        return tts.TextToSpeechClient.from_service_account_file(str(key_path()),transport='rest')
    except ImportError: raise ValueError('Install Kanaa’s Google voice client before generating narration.') from None
    except Exception: raise ValueError('The saved Google voice key could not be opened. Choose the key again in Settings → AI → Voice.') from None


def provider_error(exc):
    # Only return known messages and a Google-owned console URL, never raw RPC error text or requests.
    message=str(exc); links=re.findall(r'https://console\.cloud\.google\.com/[A-Za-z0-9_/?=&%:.#-]+',message)
    url=links[0] if links else 'https://console.cloud.google.com/apis/library/texttospeech.googleapis.com'
    if 'BILLING' in message.upper() or 'billing' in message:
        return ValueError('Google Cloud billing is off for this project. Enable billing: '+url)
    if any(word in message.upper() for word in ('SERVICE_DISABLED','API HAS NOT BEEN USED','API IS DISABLED')):
        return ValueError('The Google Cloud Text-to-Speech API is disabled. Enable it: '+url)
    if any(word in message.upper() for word in ('PERMISSION_DENIED','UNAUTHENTICATED','INVALID_GRANT','403','401')):
        return ValueError('Google rejected this voice key. Check its Text-to-Speech permissions in Google Cloud.')
    return ValueError('Google could not generate this voice. Check the voice and its supported speed/pitch settings, then try again. No other voice was used.')


def family(voice): return next((name for name in PRICES if f'-{name}-' in voice),None)


def voices():
    found={}
    try:
        api=client()
        for language in ('ta-IN','en-IN'):
            for voice in api.list_voices(request={'language_code':language},retry=None).voices:
                if language in voice.language_codes:
                    found[voice.name]={'name':voice.name,'language':language,'family':family(voice.name),'price_per_million':PRICES.get(family(voice.name)),'sentence_captions':family(voice.name)=='Chirp3-HD'}
    except ValueError: raise
    except Exception as exc: raise provider_error(exc) from None
    return sorted(found.values(),key=lambda v: (v['language']!='ta-IN',list(PRICES).index(v['family']) if v['family'] in PRICES else 99,v['name']))


def sentences(script):
    # Keep decimal points and initials; split punctuation only when followed by whitespace, or at a newline.
    lines=[line.strip() for line in re.split(r'(?<=[!?।])\s+|(?<=\.)\s+(?=[^0-9])|\n+',script.strip()) if line.strip()]
    if not lines or len(lines)>200 or len(script)>30000: raise ValueError('Paste 1–200 sentences, up to 30,000 characters.')
    if any(len(line)>500 or len(line.encode())>4500 for line in lines): raise ValueError('Split long sentences into shorter lines (under 500 characters each).')
    return lines


def parameters(voice,speed,pitch):
    if not re.fullmatch(r'(ta|en)-IN-[A-Za-z0-9-]{1,100}',voice) or not family(voice): raise ValueError('Choose a supported Tamil or Indian English voice from the live list.')
    if not .25<=speed<=2 or not -20<=pitch<=20: raise ValueError('Use speed 0.25–2 and pitch −20–20.')


def payload(text,voice,pitch):
    words=text.split()
    if family(voice)=='Chirp3-HD':
        if pitch: return {'ssml':f'<speak><prosody pitch="{pitch:+g}st">{html.escape(text)}</prosody></speak>'},[]
        return {'text':text},[]
    marked=' '.join(f'<mark name="w{i}"/>{html.escape(word)}' for i,word in enumerate(words))
    return {'ssml':f'<speak>{marked}</speak>'},words


def cache_id(text,voice,speed,pitch):
    raw=json.dumps([1,text,voice,float(speed),float(pitch)],ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def cached_line(text,voice,speed,pitch):
    identifier=cache_id(text,voice,speed,pitch); path=settings.data_dir/'video_audio'/identifier; meta=settings.data_dir/'voice'/(identifier+'.json')
    if path.is_file() and meta.is_file():
        try:
            value=json.loads(meta.read_text())
            if value['duration']>0: return value
        except (ValueError,KeyError): pass
    if path.is_file():
        try:
            with wave.open(str(path),'rb') as wav: duration=wav.getnframes()/wav.getframerate()
            if duration>0:
                value={'asset_id':identifier,'text':text,'voice':voice,'speed':speed,'pitch':pitch,'duration':duration,'words':[],'caption_timing':'audio-sentence'}
                atomic(meta,json.dumps(value,ensure_ascii=False).encode());return value
        except (wave.Error,EOFError):pass
    return None


def estimate(script,voice,speed=1,pitch=0):
    parameters(voice,speed,pitch); lines=sentences(script); rate=PRICES[family(voice)]
    costs=[];cached=0
    for text in lines:
        if cached_line(text,voice,speed,pitch): costs.append(0); cached+=1; continue
        body,_=payload(text,voice,pitch); content=body.get('text') or re.sub(r'<mark\b[^>]*/>','',body['ssml'])
        if len(next(iter(body.values())).encode())>5000:raise ValueError('Split this sentence into shorter lines so its speech markup fits Google’s request limit.')
        costs.append(len(content)*rate/1_000_000)
    quote=hashlib.sha256(json.dumps([script,voice,speed,pitch],ensure_ascii=False).encode()).hexdigest()
    return {'quote':quote,'usd':round(sum(costs),8),'preview_usd':round(costs[0],8),'characters':len(script),'sentences':len(lines),'cached_sentences':cached,'rate_per_million':rate,'pricing_url':'https://cloud.google.com/text-to-speech/pricing','pricing_checked':'2026-11-17','sentence_captions':family(voice)=='Chirp3-HD'}


def generate_line(text,voice,speed,pitch,api):
    existing=cached_line(text,voice,speed,pitch)
    if existing: return existing
    body,words=payload(text,voice,pitch)
    config={'audio_encoding':'LINEAR16','speaking_rate':speed}
    if family(voice)!='Chirp3-HD': config['pitch']=pitch
    request={'input':body,'voice':{'language_code':voice[:5],'name':voice},'audio_config':config}
    if words: request['enable_time_pointing']=['SSML_MARK']
    try: response=api.synthesize_speech(request=request,retry=None,timeout=120)
    except Exception as exc: raise provider_error(exc) from None
    identifier=cache_id(text,voice,speed,pitch); target=settings.data_dir/'video_audio'/identifier
    # Persist the billed result before doing secondary work. A later retry can recover from this WAV.
    atomic(target,response.audio_content)
    try:
        with wave.open(str(target),'rb') as wav: duration=wav.getnframes()/wav.getframerate()
        if duration<=0: raise ValueError()
    except (wave.Error,ValueError,EOFError): raise ValueError('Google returned an unreadable voice recording. No replacement voice was requested.') from None
    points={int(point.mark_name[1:]):float(point.time_seconds) for point in getattr(response,'timepoints',[]) if re.fullmatch(r'w\d+',point.mark_name)}
    timing=[{'w':word,'s':points[i]} for i,word in enumerate(words)] if words and all(i in points and len(words[i])<=80 for i in range(len(words))) else []
    if timing and (any(not 0<=w['s']<duration for w in timing) or any(b['s']<a['s'] for a,b in zip(timing,timing[1:]))): timing=[]
    result={'asset_id':identifier,'text':text,'voice':voice,'speed':speed,'pitch':pitch,'duration':duration,'words':timing,'caption_timing':'provider-words' if timing else 'audio-sentence'}
    atomic(settings.data_dir/'voice'/(identifier+'.json'),json.dumps(result,ensure_ascii=False).encode())
    return result


def generate(script,voice,speed,pitch,quote,max_cost,preview=False):
    with _lock:
        price=estimate(script,voice,speed,pitch)
        expected=price['preview_usd'] if preview else price['usd']
        if quote!=price['quote'] or expected>max_cost+1e-8: raise ValueError('Review the current voice cost estimate before generating.')
        lines=sentences(script)[:1] if preview else sentences(script)
        missing=any(not cached_line(text,voice,speed,pitch) for text in lines)
        api=client() if missing else None
        return [generate_line(text,voice,speed,pitch,api) for text in lines]
