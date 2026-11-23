/**
 * Clone a person: Follow me (copies of the person a moment behind them) or From my takes (other clips of the same
 * scene, the person cut out of each). Best on a tripod shot: the scene behind must stay still.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users } from 'lucide-react';
import { photoThumbUrl } from '../api/client';
import { t } from '../i18n';
import { cloneFollow, cloneMoments, cloneTakes } from '../timeline/clone';
import { clipLength, mainLayer, type Clip } from '../timeline/model';
import { newId } from './editor-constants';
import { EditorContext } from './state/EditorContext';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:clone';
export function openClone(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function CloneHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline) return null;
  const clip = mainLayer(store.timeline).items.find((item) => item.id === clipId);
  if (!clip) return null;
  return createPortal(<CloneDialog clip={clip} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function CloneDialog({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const [mode, setMode] = useState<'moments' | 'follow' | 'takes'>('moments');
  const [copies, setCopies] = useState(2), [gap, setGap] = useState(0.8);
  const [takes, setTakes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEscape(true, onClose);
  const others = mainLayer(store.timeline!).items.filter((item) => item.id !== clip.id);
  const apply = () => {
    setError(null);
    try {
      const timeline = store.timeline!;
      const next = mode === 'moments' ? cloneMoments(timeline, clip.id, copies, newId) : mode === 'follow' ? cloneFollow(timeline, clip.id, copies, gap, newId) : cloneTakes(timeline, clip.id, others.filter((item) => takes.includes(item.id)), newId);
      store.change(next);
      onClose();
    } catch (problem) { setError((problem as Error).message); }
  };
  const chips = <T extends number>(label: string, options: [T, string][], value: T, set: (value: T) => void) => <div className="ed-chips" role="group" aria-label={t(label)}>
    {options.map(([option, text]) => <button key={option} className={value === option ? 'on' : ''} aria-pressed={value === option} onClick={() => set(option)}>{text}</button>)}</div>;
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Clone the person')} onClick={onClose}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(420px, calc(100vw - 24px))' }}>
      <h2><Users size={16}/> {t('Clone the person')}</h2>
      <div className="ed-chips" role="group" aria-label={t('How')}>
        <button className={mode === 'moments' ? 'on' : ''} aria-pressed={mode === 'moments'} onClick={() => setMode('moments')}>{t('Many moments')}</button>
        <button className={mode === 'follow' ? 'on' : ''} aria-pressed={mode === 'follow'} onClick={() => setMode('follow')}>{t('Follow me')}</button>
        <button className={mode === 'takes' ? 'on' : ''} aria-pressed={mode === 'takes'} onClick={() => setMode('takes')}>{t('From my takes')}</button>
      </div>
      {mode === 'moments' ? <>
        <p className="ed-tip">{t('Film yourself doing different things in one spot, one after another. The clip is cut into parts and every part plays at once: you, many times, each doing something else.')}</p>
        <h3 className="ed-sub">{t('Clones')}</h3>{chips('Clones', [[1, '2'], [2, '3'], [3, '4'], [4, '5']], copies, setCopies)}
        <p className="ed-tip">{t('The shot becomes as long as one part. Remove clones brings the whole clip back.')}</p>
      </> : mode === 'follow' ? <>
        <p className="ed-tip">{t('Copies of the person from a moment earlier follow behind them, each a little further back in time.')}</p>
        <h3 className="ed-sub">{t('Clones')}</h3>{chips('Clones', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], copies, setCopies)}
        <h3 className="ed-sub">{t('How far behind')}</h3>{chips('How far behind', [[0.4, t('Close')], [0.8, t('Spaced')], [1.5, t('Far apart')]], gap, setGap)}
      </> : <>
        <p className="ed-tip">{t('Choose other takes of the same scene; the person is cut out of each and they all appear together.')}</p>
        {others.length ? <div className="ed-youtube-pictures ed-clone-takes" role="group" aria-label={t('Takes')}>
          {others.map((item) => { const on = takes.includes(item.id); return <button key={item.id} className={on ? 'on' : ''} aria-pressed={on} title={`${item.name ?? t('Take')} · ${clipLength(item).toFixed(1)} s`}
            onClick={() => setTakes((current) => (on ? current.filter((id) => id !== item.id) : [...current, item.id]))}><img src={photoThumbUrl(item.media_id)} alt=""/></button>; })}
        </div> : <p className="ed-tip">{t('Add your other takes to the main track first.')}</p>}
      </>}
      <p className="ed-tip">{t('Best on a tripod: the scene behind must not move. Each clone is its own layer.')}</p>
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        <button className="ed-button primary" disabled={mode === 'takes' && !takes.length} onClick={apply}>{t('Clone')}</button>
        <button className="ed-button" onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
