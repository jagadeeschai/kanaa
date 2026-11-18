import { useState } from 'react';
import { Hourglass, MoveLeft, MoveRight } from 'lucide-react';
import { t } from '../i18n';
import type { Timeline } from '../timeline/model';
import { mainLayer } from '../timeline/model';
import { ValueSlider } from './controls';
import { useEditor } from './state/EditorContext';
import './narrate.css';

/** Documentary sound (documentary_audio.py): soft whooshes on chapters, J and L cuts, and a silent beat before a number. */
export default function DocumentarySoundPanel() {
  const { timeline, change, selectedId } = useEditor();
  const [seconds, setSeconds] = useState(0.4), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const picture = mainLayer(timeline).items.some((item) => item.id === selectedId);
  const number = timeline.layers.some((layer) => layer.kind === 'text' && layer.items.some((item) => item.id === selectedId && item.graphic?.kind === 'count-up'));
  const run = async (action: string, enabled = true) => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/documentary/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeline, action, enabled, item_id: selectedId ?? '', seconds }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail);
      change(result as Timeline);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="ed-add ed-narrate" aria-label={t('Documentary sound')}><h3 className="ed-sub">{t('Documentary sound')}</h3>
    <fieldset disabled={busy}>
      <label className="ed-check"><input type="checkbox" checked={timeline.documentary_sound?.enabled ?? false} onChange={(event) => void run('sounds', event.target.checked)}/>{t('Soft whoosh on chapters and big graphics')}</label>
      <ValueSlider label="Lead, trail or pause" value={seconds} min={0.1} max={3} step={0.1} defaultValue={0.4} decimals={1} unit=" s" onChange={setSeconds}/>
      <p className="ed-tip">{t(picture ? 'Narration can start before this picture (J cut) or carry on after it (L cut).' : number ? 'A silent beat holds the picture before this number; the sound waits too.' : 'Select a main-track picture for a J or L cut, or a count-up number for a silent beat.')}</p>
      <div className="ed-narrate-actions">
        <button className="ed-button" disabled={!picture} onClick={() => void run('lead')}><MoveLeft size={14}/>{t('J cut')}</button>
        <button className="ed-button" disabled={!picture} onClick={() => void run('trail')}><MoveRight size={14}/>{t('L cut')}</button>
      </div>
      <button className="ed-button wide" disabled={!number} onClick={() => void run('pause')}><Hourglass size={14}/>{t('Pause before this number')}</button>
    </fieldset>
    {error && <p className="ed-error" role="alert">{t(error)}</p>}
  </section>;
}
