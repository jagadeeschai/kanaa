/**
 * Time freeze in 3D: the moment at the playhead stops and the camera glides around the frozen scene (orbit, push in,
 * rise), people standing out from the background. Kanaa makes it once (it shows in Jobs); ⌘Z undoes it.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Orbit } from 'lucide-react';
import { getPhoto, requestJson, waitForJob } from '../api/client';
import { t } from '../i18n';
import { addFreeze3d, cannotFreeze3d, changeFreeze3d, FREEZE_LENGTHS, FREEZE_MOVES, freezePoint, type FreezeMove } from '../timeline/freeze3d';
import { findClip } from '../timeline/model';
import { newId } from './editor-constants';
import { EditorContext } from './state/EditorContext';
import { TuneSection, type Tune } from './TuneSection';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:freeze3d';
/** Opens the dialog: for a clip already frozen in 3D (to change its move), or at the playhead (to make one). */
export function openFreeze3d(clipId: string | null) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function Freeze3dHost() {
  const store = useContext(EditorContext);
  const [open, setOpen] = useState<{ clipId: string | null } | null>(null);
  useEffect(() => {
    const show = (event: Event) => setOpen({ clipId: (event as CustomEvent<string | null>).detail });
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);
  if (!open || !store?.timeline) return null;
  return createPortal(<Freeze3dDialog clipId={open.clipId} onClose={() => setOpen(null)}/>, document.querySelector('.ed') ?? document.body);
}

function Freeze3dDialog({ clipId, onClose }: { clipId: string | null; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const frozen = clipId ? findClip(store.timeline!, clipId) : null;
  const [when] = useState(store.now);  // The moment, fixed when the dialog opened.
  const point = frozen?.freeze3d ? null : freezePoint(store.timeline!, when);
  const [move, setMove] = useState<FreezeMove>(frozen?.freeze3d?.move ?? 'orbit-right');
  const [seconds, setSeconds] = useState<number>(frozen ? frozen.out - frozen.in : 3);
  const [tune, setTune] = useState<Tune>(frozen?.freeze3d?.tune ?? {});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(frozen?.freeze3d ? null : cannotFreeze3d(point?.clip ?? null));
  useEscape(true, () => { if (busy === null) onClose(); });
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      const source = frozen?.freeze3d ? { media: frozen.freeze3d.original_media_id, at: frozen.freeze3d.at } : point ? { media: point.clip.media_id, at: point.at } : null;
      if (!source) throw new Error(t('Move the playhead onto a video clip on the main track.'));
      const length = frozen ? frozen.out - frozen.in : seconds;
      const started = await requestJson<{ status: string; output_photo_id?: number; job_id?: string }>(`/api/photos/${source.media}/freeze3d`, { method: 'POST', body: JSON.stringify({ at: source.at, seconds: length, move, tune }) });
      const made = started.output_photo_id ?? (await waitForJob<{ output_photo_id: number }>(started.job_id!, (value) => setBusy(value))).output_photo_id;
      store.addMedia(await getPhoto(made));
      store.change(frozen?.freeze3d ? changeFreeze3d(store.timeline!, frozen.id, made, move, tune) : addFreeze3d(store.timeline!, when, made, move, length, [newId(), newId()], tune));
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Time freeze in 3D')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(420px, calc(100vw - 24px))' }}>
      <h2><Orbit size={16}/> {t('Time freeze in 3D')}</h2>
      <p className="ed-tip">{t(frozen?.freeze3d ? 'Change how the camera moves around this frozen moment.' : 'The moment at the playhead stops, and the camera glides around the frozen scene: people stand out in 3D from the background.')}</p>
      <h3 className="ed-sub">{t('Camera move')}</h3>
      <div className="ed-chips" role="group" aria-label={t('Camera move')}>{FREEZE_MOVES.map((each) => <button key={each.id} className={move === each.id ? 'on' : ''} aria-pressed={move === each.id} title={t(each.about)} disabled={busy !== null} onClick={() => setMove(each.id)}>{t(each.label)}</button>)}</div>
      <p className="ed-tip">{t(FREEZE_MOVES.find((each) => each.id === move)!.about)}</p>
      {!frozen && <>
        <h3 className="ed-sub">{t('How long')}</h3>
        <div className="ed-chips" role="group" aria-label={t('How long')}>{FREEZE_LENGTHS.map((each) => <button key={each} className={seconds === each ? 'on' : ''} aria-pressed={seconds === each} disabled={busy !== null} onClick={() => setSeconds(each)}>{each} s</button>)}</div>
      </>}
      <TuneSection look="freeze3d" preset={move} tune={tune} onChange={setTune} disabled={busy !== null}/>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Freezing the moment…')} {busy ? `${Math.round(busy)}%` : ''} · {t('You can keep editing; it continues in Jobs.')}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        <button className="ed-button primary" disabled={busy !== null || Boolean(error && !frozen?.freeze3d && !point)} onClick={() => { void apply(); }}>{t(frozen?.freeze3d ? 'Change the move' : 'Freeze here')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
