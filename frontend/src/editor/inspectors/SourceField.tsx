import { useEffect,useState } from 'react';
import { t } from '../../i18n';
import type { TextItem } from '../../timeline/model';
export function SourceField({text,onChange}:{text:TextItem;onChange:(changes:Partial<TextItem>,group?:string)=>void}) {
  const direct=text.graphic?.kind==='source',value=direct ? text.text:text.source ?? '',[draft,setDraft]=useState(value);
  useEffect(()=>setDraft(value),[text.id,value]);
  return <label><span>{t('Source footnote')}</span><textarea className="ed-text" aria-label={t('Source footnote')} lang="ta" rows={2} maxLength={500} value={draft} placeholder={t('Publisher, date and link')} onChange={(event)=>{setDraft(event.target.value);if(direct){if(event.target.value.trim())onChange({text:event.target.value},`source-${text.id}`);}else onChange({source:event.target.value || null},`source-${text.id}`);}}/></label>;
}
