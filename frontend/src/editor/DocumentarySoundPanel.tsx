import { useState } from 'react';
import { t } from '../i18n';
import type { Timeline } from '../timeline/model';
import { mainLayer } from '../timeline/model';
import { useEditor } from './state/EditorContext';
export default function DocumentarySoundPanel() {
  const {timeline,change,selectedId}=useEditor();const [seconds,setSeconds]=useState(.4),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const picture=mainLayer(timeline).items.some((item)=>item.id===selectedId);
  const run=async(action:string,enabled=true)=>{setBusy(true);setError('');try{const response=await fetch('/api/documentary/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timeline,action,enabled,item_id:selectedId ?? '',seconds})});const result=await response.json();if(!response.ok)throw new Error(result.detail);change(result as Timeline);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <section className="ed-add"><h3 className="ed-sub">{t('Documentary sound')}</h3><fieldset disabled={busy}>
    <label className="ed-check"><input type="checkbox" checked={timeline.documentary_sound?.enabled ?? false} onChange={(event)=>void run('sounds',event.target.checked)}/>{t('Soft whoosh on chapters and big graphics')}</label>
    <label className="ed-field">{t('Lead, trail or pause (seconds)')}<input type="number" value={seconds} min={.1} max={3} step={.1} onChange={(event)=>setSeconds(Number(event.target.value))}/></label>
    <p className="ed-tip">{t('Select a main-track picture for a J or L cut, or a count-up number for a silent beat. A pause holds the picture and preserves the audio.')}</p>
    <button className="ed-button" disabled={!picture} onClick={()=>void run('lead')}>{t('J cut: narration leads')}</button><button className="ed-button" disabled={!picture} onClick={()=>void run('trail')}>{t('L cut: narration trails')}</button>
    <button className="ed-button" onClick={()=>void run('pause')}>{t('Pause before selected number')}</button></fieldset>{error && <p className="ed-error" role="alert">{t(error)}</p>}
  </section>;
}
