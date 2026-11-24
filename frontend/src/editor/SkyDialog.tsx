/**
 * Sky swap: a new sky in one click (golden sunset, starry night, storm clouds, clear blue), the land relit to match,
 * following the camera. Kanaa makes the copy once (it shows in Jobs); Remove new sky puts the original back.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloudSun, LoaderCircle } from 'lucide-react';
import { getPhoto, requestJson, waitForJob } from '../api/client';
import { t } from '../i18n';
import { applySky, cannotSky, removeSky, SKY_CHOICES, skyPart, type SkyChoice } from '../timeline/sky';
import { findClip } from '../timeline/model';
import { EditorContext } from './state/EditorContext';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:sky';
export function openSky(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function SkyHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline || !findClip(store.timeline, clipId)) return null;
  return createPortal(<SkyDialog clipId={clipId} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function SkyDialog({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const [preset, setPreset] = useState<SkyChoice>(clip.new_sky?.sky ?? 'sunset');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(cannotSky(clip));
  useEscape(true, () => { if (busy === null) onClose(); });
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      const part = skyPart(clip);
      const started = await requestJson<{ status: string; output_photo_id?: number; job_id?: string }>(`/api/photos/${part.media}/sky`, { method: 'POST', body: JSON.stringify({ start: part.start, end: part.end, sky: preset }) });
      const made = started.output_photo_id ?? (await waitForJob<{ output_photo_id: number }>(started.job_id!, (value) => setBusy(value))).output_photo_id;
      store.addMedia(await getPhoto(made));
      store.change(applySky(store.timeline!, clipId, made, preset));
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('New sky')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(420px, calc(100vw - 24px))' }}>
      <h2><CloudSun size={16}/> {t('New sky')}</h2>
      <p className="ed-tip">{t('A new sky where the old one was, the land relit to match it, staying put as the camera moves.')}</p>
      <div className="ed-chips" role="group" aria-label={t('New sky')}>{SKY_CHOICES.map((each) => <button key={each.id} className={preset === each.id ? 'on' : ''} aria-pressed={preset === each.id} title={t(each.about)} disabled={busy !== null} onClick={() => setPreset(each.id)}>{t(each.label)}</button>)}</div>
      <p className="ed-tip">{t(SKY_CHOICES.find((each) => each.id === preset)!.about)}</p>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Painting the new sky…')} {busy ? `${Math.round(busy)}%` : ''} · {t('You can keep editing; it continues in Jobs.')}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        {clip.new_sky && <button className="ed-button" disabled={busy !== null} onClick={() => { store.change(removeSky(store.timeline!, clipId)); onClose(); }}>{t('Remove new sky')}</button>}
        <button className="ed-button primary" disabled={busy !== null || Boolean(cannotSky(clip))} onClick={() => { void apply(); }}>{t('Apply sky')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
