import { useEffect,useState } from 'react';
import { t } from '../i18n';
import { voiceRequest } from '../api/voice';
export default function VoiceSettingsFields() {
  const [configured,setConfigured]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void voiceRequest<{configured:boolean}>('settings').then((value)=>setConfigured(value.configured)).catch((e)=>setError(e.message));},[]);
  return <section className="ai-settings-fields"><h3>{t('Voice')}</h3><p>{t('Google Cloud Text-to-Speech. Choose Kanaa’s own service-account JSON key. It stays on this Mac and is used only with Google.')}</p>
    <label className="field-label">{t('Google voice key')}<input aria-label={t('Google voice key')} type="file" accept=".json,application/json" disabled={busy} onChange={async(event)=>{
      const file=event.target.files?.[0];event.target.value='';if(!file)return;
      setBusy(true);setError('');try {const body=new FormData();body.append('file',file);const response=await fetch('/api/voice/key',{method:'POST',body});const data=await response.json();if(!response.ok)throw new Error(data.detail);setConfigured(data.configured);} catch(e){setError((e as Error).message);}finally{setBusy(false);}
    }}/></label><p role="status">{t(configured ? 'Google voice key configured':'No Google voice key set')}</p>
    {configured && <button type="button" className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await voiceRequest('key',undefined,'DELETE');setConfigured(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{t('Remove voice key')}</button>}
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}
