/**
 * Remove person: right-click a picture, pick the people to take out (each is outlined and numbered), and the AI fills
 * where they were with what would be behind them. Every other pixel stays the original's. See before and after,
 * then Replace in timeline, Try again, or Keep both. The picture itself is never changed.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, UserX } from 'lucide-react';
import { findPeople, getPhoto, photoThumbUrl, startRemovePeople, waitForJob } from '../api/client';
import { findClip, updateClip } from '../timeline/model';
import { EditorContext } from './state/EditorContext';
import { t } from '../i18n';

const OPEN = 'kanaa-remove-person';
type Target = { clipId: string; mediaId: number };

export function openRemovePerson(target: Target) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: target }));
}

export function RemovePersonHost() {
  const store = useContext(EditorContext);
  const [target, setTarget] = useState<Target | null>(null);
  const [people, setPeople] = useState<{ count: number; preview: string } | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<Target>).detail;
      setTarget(next); setPeople(null); setChosen(new Set()); setResult(null); setError(null); setBusy(null);
      findPeople(next.mediaId).then((found) => { setPeople(found); if (found.count === 1) setChosen(new Set([1])); })
        .catch((problem) => setError((problem as Error).message));
    };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!target || !store) return null;
  const close = () => { if (busy === null) setTarget(null); };
  const toggle = (number: number) => setChosen((current) => { const next = new Set(current); if (next.has(number)) next.delete(number); else next.add(number); return next; });
  const run = async () => {
    setError(null); setResult(null); setBusy(0);
    try {
      const { job_id } = await startRemovePeople(target.mediaId, [...chosen].sort());
      const done = await waitForJob<{ media_id: number }>(job_id, (progress) => setBusy(progress));
      store.addMedia(await getPhoto(done.media_id));
      setResult(done.media_id);
    } catch (problem) { setError((problem as Error).message); }
    setBusy(null);
  };
  const replace = () => {
    const timeline = store.timeline;
    if (!timeline || result === null || !findClip(timeline, target.clipId)) return;
    store.change(updateClip(timeline, target.clipId, { media_id: result }));
    setTarget(null);
  };
  const looking = !people && !error;
  return createPortal(<div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Remove person')} onClick={close}>
    <div className="ed-card ed-ai-edit" onClick={(event) => event.stopPropagation()}>
      <h2><UserX size={16}/> {t('Remove person')}</h2>
      <div className="ed-ai-edit-pair">
        <figure>{people?.count ? <img src={`${people.preview}?v=${target.mediaId}`} alt=""/> : <img src={photoThumbUrl(target.mediaId)} alt=""/>}<figcaption>{t('Now')}</figcaption></figure>
        <figure>{result !== null ? <img src={photoThumbUrl(result)} alt=""/> : <div className="ed-ai-edit-wait">{busy !== null ? <><LoaderCircle className="spin" size={18}/>{t('Filling where they were…')} {busy ? `${busy}%` : ''}</> : looking ? <><LoaderCircle className="spin" size={18}/>{t('Looking for people…')}</> : t('The picture without them shows here')}</div>}<figcaption>{t('Without them')}</figcaption></figure>
      </div>
      {people && (people.count ? <>
        <p className="ed-tip">{t('Choose who to remove. The rest of the picture stays exactly as it is.')}</p>
        <div className="ed-chips" role="group" aria-label={t('People')}>{Array.from({ length: people.count }, (_, k) => k + 1).map((number) => <button key={number} className={chosen.has(number) ? 'on' : ''} aria-pressed={chosen.has(number)} disabled={busy !== null} onClick={() => toggle(number)}>{t('Person {number}', { number })}</button>)}</div>
      </> : <p className="ed-tip">{t('No people found in this picture.')}</p>)}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <p className="ed-tip">{t('The picture goes to the image AI in AI settings, and uses its credits.')}</p>
      <div className="ed-ai-edit-actions">
        {result !== null && <button className="ed-button primary" onClick={replace}>{t('Replace in timeline')}</button>}
        <button className={`ed-button ${result === null ? 'primary' : ''}`} disabled={busy !== null || !chosen.size} onClick={() => void run()}>{result === null ? t('Remove') : t('Try again')}</button>
        {result !== null && <button className="ed-button" onClick={() => setTarget(null)}>{t('Keep both')}</button>}
        <button className="ed-button" disabled={busy !== null} onClick={close}>{t('Close')}</button>
      </div>
    </div>
  </div>, document.querySelector('.ed') ?? document.body);
}
