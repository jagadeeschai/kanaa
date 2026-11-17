import { useRef,useState } from 'react';
import { t } from '../i18n';
import { voiceRequest,type Voice,type VoiceQuote,type VoiceLine } from '../api/voice';
import { useEditor } from './state/EditorContext';
import type { AudioLayer,Timeline } from '../timeline/model';

export default function NarratePanel() {
  const {timeline,now,change,selectedId}=useEditor();
  const latest=useRef(timeline);latest.current=timeline;
  const [script,setScript]=useState(''),[voices,setVoices]=useState<Voice[]>([]),[voice,setVoice]=useState(''),[speed,setSpeed]=useState(1),[pitch,setPitch]=useState(0),[gap,setGap]=useState(.15);
  const [quote,setQuote]=useState<VoiceQuote|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState(''),[note,setNote]=useState('');
  const [replaceId,setReplaceId]=useState<string|null>(null);
  const selected=timeline.layers.filter((layer)=>layer.kind==='audio' && layer.name==='Narration').flatMap((layer)=>(layer as AudioLayer).items).find((item)=>item.id===selectedId);
  const params={script,voice,speed,pitch};
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <section className="ed-add" aria-label={t('Narrate')}><h3 className="ed-sub">{t('Narrate')}</h3>
    {selected?.asset_id && <button className="ed-button" disabled={busy} onClick={()=>void run(async()=>{const line=await voiceRequest<{text:string;voice:string;speed:number;pitch:number}>(`line/${selected.asset_id}`);setScript(line.text);setVoice(line.voice);setSpeed(line.speed);setPitch(line.pitch);setQuote(null);setReplaceId(selected.id);setVoices((old)=>old.some((v)=>v.name===line.voice) ? old : [...old,{name:line.voice,language:line.voice.slice(0,5),family:null,price_per_million:1,sentence_captions:line.voice.includes('Chirp3-HD')}]);})}>{t('Redo selected narration line')}</button>}
    {replaceId && <p className="ed-tip">{t('Redoing one line. Later narration moves to fit its new duration.')} <button className="ed-button" onClick={()=>setReplaceId(null)}>{t('Add as new narration')}</button></p>}
    <p className="ed-tip">{t('A voice clip per sentence, with captions matched to its recorded duration. Reusing the same line is free from Kanaa’s cache.')}</p>
    <fieldset disabled={busy}><label>{t('Narration script')}<textarea className="ed-text" lang="ta" rows={7} maxLength={30000} value={script} onChange={(event)=>{setScript(event.target.value);setQuote(null);}}/></label>
    <button className="ed-button" onClick={()=>void run(async()=>{const found=await voiceRequest<Voice[]>('voices');setVoices(found);if(!found.some((v)=>v.name===voice))setVoice(found[0]?.name ?? '');setQuote(null);})}>{t('Load Google voices')}</button>
    <label className="ed-field">{t('Voice')}<select value={voice} onChange={(event)=>{setVoice(event.target.value);setQuote(null);}}><option value="">{t('Choose a voice')}</option>{voices.map((v)=><option key={v.name} value={v.name} disabled={!v.price_per_million}>{v.name}</option>)}</select></label>
    <details><summary>{t('More')}</summary><label className="ed-field">{t('Speed')}<input type="number" min={.25} max={2} step={.05} value={speed} onChange={(event)=>{setSpeed(Number(event.target.value));setQuote(null);}}/></label><label className="ed-field">{t('Pitch')}<input type="number" min={-20} max={20} step={1} value={pitch} onChange={(event)=>{setPitch(Number(event.target.value));setQuote(null);}}/></label><label className="ed-field">{t('Gap between sentences')}<input type="number" min={0} max={2} step={.05} value={gap} onChange={(event)=>setGap(Number(event.target.value))}/></label></details>
    <button className="ed-button" disabled={!voice || !script.trim()} onClick={()=>void run(async()=>setQuote(await voiceRequest<VoiceQuote>('estimate',params)))}>{t('Estimate voice cost')}</button>
    {quote && <><p role="status">{t('Estimated Google cost')}: US${quote.usd.toFixed(5)} · {quote.cached_sentences}/{quote.sentences} {t('sentences cached')}. {t('Preview first line')}: US${quote.preview_usd.toFixed(5)}. <a href={quote.pricing_url} target="_blank" rel="noreferrer">{t('Google pricing')}</a></p><p className="ed-tip">{t(quote.sentence_captions ? 'This voice uses sentence captions timed to the audio.':'Word captions use Google’s timing marks when available; otherwise the complete sentence follows its audio.')}</p></>}
    <button className="ed-button" disabled={!quote} onClick={()=>void run(async()=>{const result=await voiceRequest<{lines:VoiceLine[]}>('generate',{...params,quote:quote!.quote,max_cost:quote!.preview_usd,preview:true});setPreview(`/api/video-audio/${result.lines[0].asset_id}`);setQuote(await voiceRequest<VoiceQuote>('estimate',params));})}>{t('Preview first line')}</button>
    <button className="ed-button" disabled={!quote} onClick={()=>void run(async()=>{const base=timeline;const result=await voiceRequest<{timeline:Timeline;lines:VoiceLine[]}>('generate',{...params,quote:quote!.quote,max_cost:quote!.usd,timeline:base,start:now,gap,replace_id:replaceId});if(latest.current!==base)throw new Error('The timeline changed while the voice was prepared. Add it again; the recorded lines are cached.');change(result.timeline);setReplaceId(null);setNote(t('Narration added at the playhead'));setQuote(await voiceRequest<VoiceQuote>('estimate',params));})}>{t(replaceId ? 'Replace narration line':'Add to timeline')}</button>
    </fieldset>{preview && <audio aria-label={t('Narration preview')} controls src={preview}/>}{busy && <p role="status">{t('Preparing narration…')}</p>}{note && <p role="status">{note}</p>}{error && <p role="alert" className="ed-error">{t(error)}</p>}
  </section>;
}
