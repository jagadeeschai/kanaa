/**
 * Remove person: right-click a picture, pick the people to take out (each is outlined and numbered), and where they were
 * is filled with what would be behind them: on this Mac (LaMa, free) or by the image AI service. Every other pixel stays the original's. See before and after,
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
  const [people, setPeople] = useState<{ count: number; preview: string; local: boolean } | null>(null);
  const [method, setMethod] = useState<'local' | 'ai'>('local');
  const [kind, setKind] = useState<'people' | 'objects'>('people');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<Target>).detail;
      setTarget(next); setKind('people'); setResult(null); setBusy(null);
      look(next.mediaId, 'people');
    };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!target || !store) return null;
  /** Looks for people, or for things (anything in the foreground: animals, vehicles, furniture, signs...). */
  function look(mediaId: number, what: 'people' | 'objects') {
    setPeople(null); setChosen(new Set()); setError(null);
    findPeople(mediaId, what).then((found) => { setPeople(found); setMethod(found.local ? 'local' : 'ai'); if (found.count === 1) setChosen(new Set([1])); })
      .catch((problem) => setError((problem as Error).message));
  }
  const close = () => { if (busy === null) setTarget(null); };
  const toggle = (number: number) => setChosen((current) => { const next = new Set(current); if (next.has(number)) next.delete(number); else next.add(number); return next; });
  const run = async () => {
    setError(null); setResult(null); setBusy(0);
    try {
      const { job_id } = await startRemovePeople(target.mediaId, [...chosen].sort(), method, kind);
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
  return createPortal(<div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Remove person or object')} onClick={close}>
    <div className="ed-card ed-ai-edit" onClick={(event) => event.stopPropagation()}>
      <h2><UserX size={16}/> {t('Remove person or object')}</h2>
      <div className="ed-chips" role="group" aria-label={t('Remove')}>
        {(['people', 'objects'] as const).map((each) => <button key={each} className={kind === each ? 'on' : ''} aria-pressed={kind === each} disabled={busy !== null}
          onClick={() => { if (kind !== each) { setKind(each); setResult(null); look(target.mediaId, each); } }}>{t(each === 'people' ? 'People' : 'Things')}</button>)}
      </div>
      <div className="ed-ai-edit-pair">
        <figure>{people?.count ? <img src={`${people.preview}&v=${target.mediaId}`} alt=""/> : <img src={photoThumbUrl(target.mediaId)} alt=""/>}<figcaption>{t('Now')}</figcaption></figure>
        <figure>{result !== null ? <img src={photoThumbUrl(result)} alt=""/> : <div className="ed-ai-edit-wait">{busy !== null ? <><LoaderCircle className="spin" size={18}/>{t('Filling where they were…')} {busy ? `${busy}%` : ''}</> : looking ? <><LoaderCircle className="spin" size={18}/>{t(kind === 'people' ? 'Looking for people…' : 'Looking for things…')}</> : t('The picture without them shows here')}</div>}<figcaption>{t('Without them')}</figcaption></figure>
      </div>
      {people && (people.count ? <>
        <p className="ed-tip">{t(kind === 'people' ? 'Choose who to remove. The rest of the picture stays exactly as it is.' : 'Choose what to remove. Things in the foreground are found; the scenery behind them is not.')}</p>
        <div className="ed-chips" role="group" aria-label={t(kind === 'people' ? 'People' : 'Things')}>{Array.from({ length: people.count }, (_, k) => k + 1).map((number) => <button key={number} className={chosen.has(number) ? 'on' : ''} aria-pressed={chosen.has(number)} disabled={busy !== null} onClick={() => toggle(number)}>{t(kind === 'people' ? 'Person {number}' : 'Thing {number}', { number })}</button>)}</div>
        <h3 className="ed-sub">{t('Fill with')}</h3>
        <div className="ed-chips" role="group" aria-label={t('Fill with')}>
          <button className={method === 'local' ? 'on' : ''} aria-pressed={method === 'local'} disabled={!people.local || busy !== null} title={people.local ? t('Free and private: a few seconds on this Mac. Best for fields, walls, sky and water.') : t('The fill model for this Mac is not installed. Run ./install-fill.sh in the Kanaa folder.')} onClick={() => setMethod('local')}>{t('This Mac · free')}</button>
          <button className={method === 'ai' ? 'on' : ''} aria-pressed={method === 'ai'} disabled={busy !== null} title={t('Uses your image AI credits. Better when the person hides a lot.')} onClick={() => setMethod('ai')}>{t('AI service')}</button>
        </div>
      </> : <p className="ed-tip">{t(kind === 'people' ? 'No people found in this picture. Try Things.' : 'Nothing found in the foreground of this picture.')}</p>)}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <p className="ed-tip">{method === 'local' ? t('Filled on this Mac: nothing leaves it, and it costs nothing.') : t('The picture goes to the image AI in AI settings, and uses its credits.')}</p>
      <div className="ed-ai-edit-actions">
        {result !== null && <button className="ed-button primary" onClick={replace}>{t('Replace in timeline')}</button>}
        <button className={`ed-button ${result === null ? 'primary' : ''}`} disabled={busy !== null || !chosen.size} onClick={() => void run()}>{result === null ? t('Remove') : t('Try again')}</button>
        {result !== null && <button className="ed-button" onClick={() => setTarget(null)}>{t('Keep both')}</button>}
        <button className="ed-button" disabled={busy !== null} onClick={close}>{t('Close')}</button>
      </div>
    </div>
  </div>, document.querySelector('.ed') ?? document.body);
}
