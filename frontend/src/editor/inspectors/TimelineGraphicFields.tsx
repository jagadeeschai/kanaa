import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { TextItem } from '../../timeline/model';
import { parsePoints } from '../../timeline/sequence-graphics';
import { More } from '../layout';

export function TimelineGraphicFields({ text, onChange }: { text: TextItem; onChange: (changes: Partial<TextItem>, group?: string) => void }) {
  const graphic = text.graphic!, canonical = (graphic.points ?? []).map((p) => `${p.date}${p.label ? `, ${p.label}` : ''}`).join('\n');
  const [draft,setDraft] = useState(canonical), [error,setError] = useState(''), saved = useRef(canonical);
  useEffect(() => { if(canonical !== saved.current) { setDraft(canonical); saved.current=canonical; } },[canonical]);
  return <><label><span>{t('Timeline points')}</span><textarea className="ed-text" aria-label={t('Timeline points')} lang="ta" rows={8} value={draft} placeholder={t('date, label')} onChange={(event) => {
    const value=event.target.value; setDraft(value); const parsed=parsePoints(value); setError(parsed.error ?? '');
    if(parsed.points) { saved.current=parsed.points.map((p)=>`${p.date}${p.label ? `, ${p.label}` : ''}`).join('\n'); onChange({graphic:{...graphic,points:parsed.points}},`points-${text.id}`); }
  }}/></label>{error && <p className="ed-error">{t(error)}</p>}<More><label className="ed-check"><input type="checkbox" checked={graphic.timeline_vertical ?? false} onChange={(event)=>onChange({graphic:{...graphic,timeline_vertical:event.target.checked}})}/>{t('Vertical timeline')}</label></More></>;
}
