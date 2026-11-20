/**
 * Pop-out (3D) for a video clip: choose the person (numbered in the clip), a move, and where the words go. The person's
 * cut-out rides above the clip, moving toward you while the scene behind them dims. One click; ⌘Z or Remove pop-out undoes it.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers3, LoaderCircle } from 'lucide-react';
import { getPhoto, instancesPictureUrl } from '../api/client';
import { t } from '../i18n';
import { findClip, mainLayer } from '../timeline/model';
import { applyVideoPopout, VIDEO_POPOUT_PRESETS, type VideoPopoutPreset } from '../timeline/video-popout';
import { newId } from './editor-constants';
import { useFoundInClip } from './inspectors/parts';
import { EditorContext } from './state/EditorContext';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:video-popout';
type Target = { clipId: string; mediaId: number };
export function openVideoPopout(target: Target) { window.dispatchEvent(new CustomEvent(OPEN, { detail: target })); }

export function VideoPopoutHost() {
  const store = useContext(EditorContext);
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    const open = (event: Event) => setTarget((event as CustomEvent<Target>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!target || !store?.timeline) return null;
  const clip = findClip(store.timeline, target.clipId);
  if (!clip || !mainLayer(store.timeline).items.includes(clip)) return null;
  return createPortal(<VideoPopout clipId={target.clipId} mediaId={target.mediaId} onClose={() => setTarget(null)}/>, document.querySelector('.ed') ?? document.body);
}

function VideoPopout({ clipId, mediaId, onClose }: { clipId: string; mediaId: number; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const { tracks, found, key, steady, backwards } = useFoundInClip(clip, 'people');
  const [chosen, setChosen] = useState<number[]>([]);
  const [preset, setPreset] = useState<VideoPopoutPreset>('forward');
  const [wordsBehind, setWordsBehind] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(true, onClose);
  useEffect(() => { if (tracks?.length === 1) setChosen([tracks[0].id]); }, [tracks]);
  const toggle = (id: number) => setChosen((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  const apply = async () => {
    setError(null);
    try {
      const picture = await getPhoto(mediaId);
      const centres = (tracks ?? []).filter((track) => chosen.includes(track.id) && track.centre).map((track) => track.centre!);
      const at: [number, number] = centres.length ? [centres.reduce((sum, c) => sum + c[0], 0) / centres.length, centres.reduce((sum, c) => sum + c[1], 0) / centres.length] : [0.5, 0.5];
      store.change(applyVideoPopout(store.timeline!, clipId, chosen, at, { width: picture.width ?? 1920, height: picture.height ?? 1080 }, preset, wordsBehind, newId(), `layer-${newId()}`));
      onClose();
    } catch (problem) { setError((problem as Error).message); }
  };
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Pop-out (3D)')} onClick={onClose}>
    <div className="ed-card ed-ai-edit" onClick={(event) => event.stopPropagation()}>
      <h2><Layers3 size={16}/> {t('Pop-out (3D)')}</h2>
      {found.key === key && found.problem ? <p className="ed-error" role="alert">{found.problem}</p>
        : !tracks ? <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Finding the people in this clip…')} {found.progress ? `${Math.round(found.progress)}%` : ''}</p>
        : !tracks.length ? <p className="ed-tip">{t('No people were found in this clip.')}</p>
        : <>
          <img className="ed-who-picture" src={`${instancesPictureUrl(mediaId, 'people', steady, backwards)}&v=${tracks.map((track) => track.id).join('-')}`} alt={t('The clip with each person numbered')}/>
          <p className="ed-tip">{t('Choose who pops out.')}</p>
          <div className="ed-chips" role="group" aria-label={t('People')}>{tracks.map((track) => <button key={track.id} className={chosen.includes(track.id) ? 'on' : ''} aria-pressed={chosen.includes(track.id)} onClick={() => toggle(track.id)}><i className="ed-who-dot" style={{ background: track.colour }}/>{t('Person {number}', { number: track.label })}</button>)}</div>
        </>}
      <h3 className="ed-sub">{t('Move')}</h3>
      <div className="ed-chips" role="group" aria-label={t('Move')}>{VIDEO_POPOUT_PRESETS.map((each) => <button key={each.id} className={preset === each.id ? 'on' : ''} aria-pressed={preset === each.id} title={t(each.about)} onClick={() => setPreset(each.id)}>{t(each.label)}</button>)}</div>
      <h3 className="ed-sub">{t('Words')}</h3>
      <div className="ed-chips" role="group" aria-label={t('Words')}>
        <button className={!wordsBehind ? 'on' : ''} aria-pressed={!wordsBehind} onClick={() => setWordsBehind(false)}>{t('In front of the person')}</button>
        <button className={wordsBehind ? 'on' : ''} aria-pressed={wordsBehind} onClick={() => setWordsBehind(true)}>{t('Behind the person')}</button>
      </div>
      <p className="ed-tip">{t('In a video the scene behind the person can’t be filled in, so the moves are the ones where they come toward you. Best when they stay in view.')}</p>
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        <button className="ed-button primary" disabled={!chosen.length} onClick={() => { void apply(); }}>{t('Apply to timeline')}</button>
        <button className="ed-button" onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
