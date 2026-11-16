import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { TextItem } from '../../timeline/model';
import { parseSteps } from '../../timeline/sequence-graphics';
import { useEditor } from '../state/EditorContext';
import { More } from '../layout';

export function SequenceGraphicFields({ text, onChange }: { text: TextItem; onChange: (changes: Partial<TextItem>, group?: string) => void }) {
  const graphic = text.graphic!, { now } = useEditor();
  const canonical = (graphic.steps ?? []).join('\n');
  const [draft, setDraft] = useState(canonical), [error, setError] = useState('');
  const saved = useRef(canonical);
  useEffect(() => { if (canonical !== saved.current) { setDraft(canonical); saved.current = canonical; } }, [canonical]);
  useEffect(() => { setDraft(canonical); setError(''); saved.current = canonical; }, [text.id]);
  const times = graphic.step_times ?? [];
  return <>
    <label><span>{t('Steps')}</span><textarea className="ed-text" aria-label={t('Steps')} lang="ta" rows={8} value={draft} onChange={(event) => {
      const value = event.target.value; setDraft(value); const parsed = parseSteps(value); setError(parsed.error ?? '');
      if (parsed.steps) { saved.current = parsed.steps.join('\n'); onChange({ graphic: { ...graphic, steps: parsed.steps, step_times: times.slice(0, parsed.steps.length) } }, `steps-${text.id}`); }
    }}/></label>
    {error && <p className="ed-error">{t(error)}</p>}
    <button className="ed-btn" disabled={times.length >= (graphic.steps?.length ?? 0)} onClick={() => {
      const at = Math.round((now - text.start) * 1000000) / 1000000;
      if (at < 0 || at >= text.length || (times.length > 0 && at <= times[times.length - 1])) { setError('Move the playhead forward inside this clip.'); return; }
      setError(''); onChange({ graphic: { ...graphic, step_times: [...times, at] } });
    }}>{times.length >= (graphic.steps?.length ?? 0) ? t('All steps timed') : t('Time each step to the playhead')} ({Math.min(times.length + 1, graphic.steps?.length ?? 0)}/{graphic.steps?.length})</button>
    {times.length > 0 && <><p>{times.map((at, i) => `${i + 1}: ${at.toFixed(2)}s`).join(' · ')}</p><button className="ed-btn" onClick={() => onChange({ graphic: { ...graphic, step_times: null } })}>{t('Use even timing')}</button></>}
    <More><label className="ed-check"><input type="checkbox" checked={graphic.step_bullets ?? false} onChange={(event) => onChange({ graphic: { ...graphic, step_bullets: event.target.checked } })}/>{t('Use bullets')}</label><label className="ed-check"><input type="checkbox" checked={graphic.highlight_current ?? true} onChange={(event) => onChange({ graphic: { ...graphic, highlight_current: event.target.checked } })}/>{t('Highlight current step')}</label></More>
  </>;
}
