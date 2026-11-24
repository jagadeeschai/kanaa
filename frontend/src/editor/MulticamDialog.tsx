/**
 * Multicam: recordings of the same moment from different cameras, lined up by sound in one click; then switch between
 * them like a live director, with the angle buttons over the preview or the 1–9 keys while it plays.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, LoaderCircle } from 'lucide-react';
import { getPhoto, photoThumbUrl, requestJson, waitForJob } from '../api/client';
import { t } from '../i18n';
import { mainLayer, type Clip } from '../timeline/model';
import { angleAt, angleLayers, cannotMulticam, makeMulticam, multicamAt, switchAngle } from '../timeline/multicam';
import { newId } from './editor-constants';
import { EditorContext } from './state/EditorContext';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:multicam';
export function openMulticam(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function MulticamHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!store?.timeline) return null;
  const clip = clipId ? mainLayer(store.timeline).items.find((item) => item.id === clipId) : null;
  return <>
    <AngleBar/>
    {clip && createPortal(<MulticamDialog clip={clip} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body)}
  </>;
}

/** The angle buttons over the preview while the playhead is on a multicam clip, and the 1–9 keys. */
function AngleBar() {
  const store = useContext(EditorContext)!;
  const live = useRef(store);
  live.current = store;
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const now = live.current;
      if (event.metaKey || event.ctrlKey || event.altKey || !/^[1-9]$/.test(event.key) || !now.timeline) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const ref = multicamAt(now.timeline, now.now);
      if (!ref || Number(event.key) > angleLayers(now.timeline, ref.id).length + 1) return;
      event.preventDefault();
      now.change(switchAngle(now.timeline, ref.id, now.now, Number(event.key)));
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, []);
  const ref = multicamAt(store.timeline!, store.now);
  if (!ref) return null;
  const count = angleLayers(store.timeline!, ref.id).length + 1;
  const showing = angleAt(store.timeline!, ref.id, store.now);
  return <div className="ed-angle-bar" role="group" aria-label={t('Camera angles')}>
    {Array.from({ length: count }, (_, k) => k + 1).map((angle) => <button key={angle} className={showing === angle ? 'on' : ''} aria-pressed={showing === angle}
      title={`${t('Switch to this angle from here')} (${angle})`} onClick={() => store.change(switchAngle(store.timeline!, ref.id, store.now, angle))}>{angle}</button>)}
    <small>{t('Press 1–9 while playing')}</small>
  </div>;
}

function MulticamDialog({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const others = mainLayer(store.timeline!).items.filter((item) => item.id !== clip.id && !cannotMulticam(item));
  const [chosen, setChosen] = useState<string[]>(others.map((item) => item.id));
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(cannotMulticam(clip));
  const [note, setNote] = useState<string | null>(null);
  useEscape(true, () => { if (busy === null) onClose(); });
  const sync = async () => {
    setError(null); setBusy(0);
    try {
      const angles = others.filter((item) => chosen.includes(item.id));
      const started = await requestJson<{ job_id: string }>('/api/multicam-sync', { method: 'POST', body: JSON.stringify({ media_ids: [clip.media_id, ...angles.map((item) => item.media_id)] }) });
      const result = await waitForJob<{ angles: { media_id: number; offset: number; synced: boolean }[] }>(started.job_id, (value) => setBusy(value));
      const found = result.angles.slice(1);
      const synced = [];
      for (const [k, item] of angles.entries()) {
        if (!found[k]?.synced) continue;
        synced.push({ clipId: item.id, offset: found[k].offset, duration: (await getPhoto(item.media_id)).duration ?? item.out });
      }
      const missed = angles.length - synced.length;
      if (!synced.length) { setError(t('These recordings did not hear the same sound, so they could not be lined up.')); return; }
      store.change(makeMulticam(store.timeline!, clip.id, synced, newId));
      setNote(missed ? `${missed} ${t('recording(s) did not match by sound and stayed on the main track.')}` : null);
      if (!missed) onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Multicam')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(440px, calc(100vw - 24px))' }}>
      <h2><Clapperboard size={16}/> {t('Multicam')}</h2>
      <p className="ed-tip">{t('Recordings of the same moment from other cameras or phones: Kanaa lines them up by their sound, then you switch between them as it plays.')}</p>
      <h3 className="ed-sub">{t('Other angles')}</h3>
      {others.length ? <div className="ed-youtube-pictures ed-clone-takes" role="group" aria-label={t('Other angles')}>
        {others.map((item) => { const on = chosen.includes(item.id); return <button key={item.id} className={on ? 'on' : ''} aria-pressed={on} disabled={busy !== null} title={item.name ?? ''}
          onClick={() => setChosen((now) => (on ? now.filter((id) => id !== item.id) : [...now, item.id]))}><img src={photoThumbUrl(item.media_id)} alt=""/></button>; })}
      </div> : <p className="ed-tip">{t('Add the other recordings to the main track first.')}</p>}
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Listening for the same sound…')} {busy ? `${Math.round(busy)}%` : ''}</p>}
      {note && <p className="ed-tip" role="status">{note}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        <button className="ed-button primary" disabled={busy !== null || !chosen.length || Boolean(cannotMulticam(clip))} onClick={() => { void sync(); }}>{t('Sync by sound')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
