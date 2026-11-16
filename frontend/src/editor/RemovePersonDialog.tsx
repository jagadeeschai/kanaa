/**
 * Remove person: right-click a picture, pick the people to take out (each is outlined and numbered), and where they were
 * is filled with what would be behind them: on this Mac (LaMa, free) or by the image AI service. Every other pixel stays the original's. See before and after,
 * then Replace in timeline, Try again, or Keep both. The picture itself is never changed.
 * The same chooser also makes a Pop-out (3D): the chosen ones and the filled scene as two layers that move apart.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from './useEscape';
import { Layers3, LoaderCircle, UserX } from 'lucide-react';
import { findPeople, getPhoto, outlineByClicks, photoThumbUrl, startPopout, startRemovePeople, waitForJob } from '../api/client';
import { applyPopout, POPOUT_PRESETS, type PopoutPictures, type PopoutPreset, type Where } from '../timeline/popout';
import { newId } from './editor-constants';
import { findClip, updateClip } from '../timeline/model';
import { EditorContext } from './state/EditorContext';
import { t } from '../i18n';

const OPEN = 'kanaa-remove-person';
type Target = { clipId: string; mediaId: number; purpose?: 'remove' | 'popout' };

export function openRemovePerson(target: Target) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: { ...target, purpose: 'remove' } }));
}

export function openPopout(target: Target) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: { ...target, purpose: 'popout' } }));
}

export function RemovePersonHost() {
  const store = useContext(EditorContext);
  const [target, setTarget] = useState<Target | null>(null);
  const [people, setPeople] = useState<{ count: number; preview: string; local: boolean } | null>(null);
  const [method, setMethod] = useState<'local' | 'ai'>('local');
  const [kind, setKind] = useState<'people' | 'objects' | 'clicks'>('people');
  const [canClick, setCanClick] = useState(false);
  // Click to choose: the clicks so far (shares of the picture; keep false takes away) and the outline they make.
  const [points, setPoints] = useState<{ x: number; y: number; keep: boolean }[]>([]);
  const [outlined, setOutlined] = useState<{ area: number; preview: string; at: number } | null>(null);
  const [outlining, setOutlining] = useState(false);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pop-out: the two pictures once made, the move to give them, and where the words go.
  const [made, setMade] = useState<PopoutPictures | null>(null);
  const [preset, setPreset] = useState<PopoutPreset>('forward');
  const [wordsBehind, setWordsBehind] = useState(false);
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<Target>).detail;
      setTarget(next); setKind('people'); setResult(null); setBusy(null); setPoints([]); setOutlined(null); setMade(null);
      look(next.mediaId, 'people');
    };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  useEscape(Boolean(target), () => { if (busy === null) setTarget(null); });
  if (!target || !store) return null;
  /** Looks for people, or for things (anything in the foreground: animals, vehicles, furniture, signs...). */
  function look(mediaId: number, what: 'people' | 'objects') {
    setPeople(null); setChosen(new Set()); setError(null);
    findPeople(mediaId, what).then((found) => { setPeople(found); setCanClick(Boolean(found.click)); setMethod(found.local ? 'local' : 'ai'); if (found.count === 1) setChosen(new Set([1])); })
      .catch((problem) => setError((problem as Error).message));
  }
  const close = () => { if (busy === null) setTarget(null); };
  /** A click on the picture (shown whole inside its box): where on the picture, as shares; Option-click takes away. */
  const clickPicture = async (event: React.MouseEvent<HTMLImageElement>) => {
    if (kind !== 'clicks' || busy !== null || outlining) return;
    const img = event.currentTarget; const box = img.getBoundingClientRect();
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const shownW = img.naturalWidth * scale; const shownH = img.naturalHeight * scale;
    const x = (event.clientX - box.left - (box.width - shownW) / 2) / shownW; const y = (event.clientY - box.top - (box.height - shownH) / 2) / shownH;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const next = [...points, { x, y, keep: !event.altKey }];
    setPoints(next); setOutlining(true); setError(null); setResult(null);
    try { const found = await outlineByClicks(target.mediaId, next); setOutlined({ ...found, at: Date.now() }); setChosen(found.area > 0 ? new Set([1]) : new Set()); }
    catch (problem) { setError((problem as Error).message); }
    setOutlining(false);
  };
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
  const popout = target.purpose === 'popout';
  const makePopout = async () => {
    setError(null); setMade(null); setBusy(0);
    try {
      const { job_id } = await startPopout(target.mediaId, [...chosen].sort(), kind);
      const done = await waitForJob<{ background_id: number; person_id: number; where: Where }>(job_id, (progress) => setBusy(progress));
      const [background, person, picture] = await Promise.all([getPhoto(done.background_id), getPhoto(done.person_id), getPhoto(target.mediaId)]);
      store.addMedia(background); store.addMedia(person);
      setMade({ backgroundId: background.id, personId: person.id, where: done.where, width: picture.width ?? 1920, height: picture.height ?? 1080 });
    } catch (problem) { setError((problem as Error).message); }
    setBusy(null);
  };
  const applyMade = () => {
    const timeline = store.timeline;
    if (!timeline || !made) return;
    try { store.change(applyPopout(timeline, target.clipId, made, preset, wordsBehind, newId(), `layer-${newId()}`)); setTarget(null); }
    catch (problem) { setError((problem as Error).message); }
  };
  const replace = () => {
    const timeline = store.timeline;
    if (!timeline || result === null || !findClip(timeline, target.clipId)) return;
    store.change(updateClip(timeline, target.clipId, { media_id: result }));
    setTarget(null);
  };
  const looking = !people && !error;
  return createPortal(<div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t(popout ? 'Pop-out (3D)' : 'Remove person or object')} onClick={close}>
    <div className="ed-card ed-ai-edit" onClick={(event) => event.stopPropagation()}>
      <h2>{popout ? <Layers3 size={16}/> : <UserX size={16}/>} {t(popout ? 'Pop-out (3D)' : 'Remove person or object')}</h2>
      <div className="ed-chips" role="group" aria-label={t('Remove')}>
        {(['people', 'objects'] as const).map((each) => <button key={each} className={kind === each ? 'on' : ''} aria-pressed={kind === each} disabled={busy !== null}
          onClick={() => { if (kind !== each) { setKind(each); setResult(null); look(target.mediaId, each); } }}>{t(each === 'people' ? 'People' : 'Things')}</button>)}
        <button className={kind === 'clicks' ? 'on' : ''} aria-pressed={kind === 'clicks'} disabled={busy !== null || !canClick} title={canClick ? t('Click anything in the picture: a rock, a tree, a pole, a building') : t('Click to choose is not installed. Run ./install-fill.sh in the Kanaa folder.')}
          onClick={() => { if (kind !== 'clicks') { setKind('clicks'); setResult(null); setChosen(outlined?.area ? new Set([1]) : new Set()); } }}>{t('Click to choose')}</button>
      </div>
      <div className="ed-ai-edit-pair">
        <figure>{kind === 'clicks'
          ? <img className="ed-click-pick" src={outlined ? `${outlined.preview}&at=${outlined.at}` : photoThumbUrl(target.mediaId)} alt={t('Click what to remove')} onClick={(event) => { void clickPicture(event); }}/>
          : people?.count ? <img src={`${people.preview}&v=${target.mediaId}`} alt=""/> : <img src={photoThumbUrl(target.mediaId)} alt=""/>}<figcaption>{kind === 'clicks' ? (outlining ? t('Outlining…') : t('Click what to remove · Option-click to take away')) : t('Now')}</figcaption></figure>
        <figure>{popout ? (made ? <img src={photoThumbUrl(made.backgroundId)} alt=""/> : <div className="ed-ai-edit-wait">{busy !== null ? <><LoaderCircle className="spin" size={18}/>{t('Cutting out and filling behind…')} {busy ? `${busy}%` : ''}</> : t('The scene behind them shows here')}</div>) : result !== null ? <img src={photoThumbUrl(result)} alt=""/> : <div className="ed-ai-edit-wait">{busy !== null ? <><LoaderCircle className="spin" size={18}/>{t('Filling where they were…')} {busy ? `${busy}%` : ''}</> : looking ? <><LoaderCircle className="spin" size={18}/>{t(kind === 'people' ? 'Looking for people…' : 'Looking for things…')}</> : t('The picture without them shows here')}</div>}<figcaption>{t('Without them')}</figcaption></figure>
      </div>
      {kind === 'clicks' && <div className="ed-pair"><button className="ed-button" disabled={!points.length || busy !== null} onClick={() => { setPoints([]); setOutlined(null); setChosen(new Set()); }}>{t('Clear clicks')}</button></div>}
      {kind !== 'clicks' && people && (people.count ? <>
        <p className="ed-tip">{t(popout ? (kind === 'people' ? 'Choose who pops out.' : 'Choose what pops out. Things in the foreground are found; the scenery behind them is not.') : kind === 'people' ? 'Choose who to remove. The rest of the picture stays exactly as it is.' : 'Choose what to remove. Things in the foreground are found; the scenery behind them is not.')}</p>
        <div className="ed-chips" role="group" aria-label={t(kind === 'people' ? 'People' : 'Things')}>{Array.from({ length: people.count }, (_, k) => k + 1).map((number) => <button key={number} className={chosen.has(number) ? 'on' : ''} aria-pressed={chosen.has(number)} disabled={busy !== null} onClick={() => toggle(number)}>{t(kind === 'people' ? 'Person {number}' : 'Thing {number}', { number })}</button>)}</div>
      </> : <p className="ed-tip">{t(kind === 'people' ? 'No people found in this picture. Try Things.' : 'Nothing found in the foreground of this picture.')}</p>)}
      {popout && <>
        <h3 className="ed-sub">{t('Move')}</h3>
        <div className="ed-chips" role="group" aria-label={t('Move')}>{POPOUT_PRESETS.map((each) => <button key={each.id} className={preset === each.id ? 'on' : ''} aria-pressed={preset === each.id} title={t(each.about)} onClick={() => setPreset(each.id)}>{t(each.label)}</button>)}</div>
        <h3 className="ed-sub">{t('Words')}</h3>
        <div className="ed-chips" role="group" aria-label={t('Words')}>
          <button className={!wordsBehind ? 'on' : ''} aria-pressed={!wordsBehind} onClick={() => setWordsBehind(false)}>{t('In front of the person')}</button>
          <button className={wordsBehind ? 'on' : ''} aria-pressed={wordsBehind} onClick={() => setWordsBehind(true)}>{t('Behind the person')}</button>
        </div>
      </>}
      {!popout && (kind === 'clicks' || people) && <>
        <h3 className="ed-sub">{t('Fill with')}</h3>
        <div className="ed-chips" role="group" aria-label={t('Fill with')}>
          <button className={method === 'local' ? 'on' : ''} aria-pressed={method === 'local'} disabled={!people?.local || busy !== null} title={people?.local ? t('Free and private: a few seconds on this Mac. Best for fields, walls, sky and water.') : t('The fill model for this Mac is not installed. Run ./install-fill.sh in the Kanaa folder.')} onClick={() => setMethod('local')}>{t('This Mac · free')}</button>
          <button className={method === 'ai' ? 'on' : ''} aria-pressed={method === 'ai'} disabled={busy !== null} title={t('Uses your image AI credits. Better when the person hides a lot.')} onClick={() => setMethod('ai')}>{t('AI service')}</button>
        </div>
      </>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <p className="ed-tip">{popout ? t('Made on this Mac, free. Your picture stays as it is; each layer can still be changed in Motion.') : method === 'local' ? t('Filled on this Mac: nothing leaves it, and it costs nothing.') : t('The picture goes to the image AI in AI settings, and uses its credits.')}</p>
      {popout ? <div className="ed-ai-edit-actions">
        {made && <button className="ed-button primary" onClick={applyMade}>{t('Apply to timeline')}</button>}
        <button className={`ed-button ${made ? '' : 'primary'}`} disabled={busy !== null || !chosen.size} onClick={() => void makePopout()}>{made ? t('Make again') : t('Make 3D')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={close}>{t('Close')}</button>
      </div> : <div className="ed-ai-edit-actions">
        {result !== null && <button className="ed-button primary" onClick={replace}>{t('Replace in timeline')}</button>}
        <button className={`ed-button ${result === null ? 'primary' : ''}`} disabled={busy !== null || !chosen.size} onClick={() => void run()}>{result === null ? t('Remove') : t('Try again')}</button>
        {result !== null && <button className="ed-button" onClick={() => setTarget(null)}>{t('Keep both')}</button>}
        <button className="ed-button" disabled={busy !== null} onClick={close}>{t('Close')}</button>
      </div>}
    </div>
  </div>, document.querySelector('.ed') ?? document.body);
}
