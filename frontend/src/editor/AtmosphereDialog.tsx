/**
 * Atmosphere from depth: mist, dusty sunset haze, rain haze or low fog laid into a clip by distance, one click,
 * Light / Medium / Heavy. Kanaa makes the copy once (it shows in Jobs); Remove atmosphere puts the original back.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloudFog, LoaderCircle } from 'lucide-react';
import { getPhoto, requestJson, waitForJob } from '../api/client';
import { t } from '../i18n';
import { applyAtmosphere, ATMOSPHERE_PRESETS, atmospherePart, cannotAtmosphere, removeAtmosphere, type AtmospherePreset, type AtmosphereStrength } from '../timeline/atmosphere';
import { findClip } from '../timeline/model';
import { EditorContext } from './state/EditorContext';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:atmosphere';
export function openAtmosphere(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function AtmosphereHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline || !findClip(store.timeline, clipId)) return null;
  return createPortal(<AtmosphereDialog clipId={clipId} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function AtmosphereDialog({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const [preset, setPreset] = useState<AtmospherePreset>(clip.atmosphere?.preset ?? 'mist');
  const [strength, setStrength] = useState<AtmosphereStrength>(clip.atmosphere?.strength ?? 'medium');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(cannotAtmosphere(clip));
  useEscape(true, () => { if (busy === null) onClose(); });
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      const part = atmospherePart(clip);
      const started = await requestJson<{ status: string; output_photo_id?: number; job_id?: string }>(`/api/photos/${part.media}/atmosphere`, { method: 'POST', body: JSON.stringify({ start: part.start, end: part.end, preset, strength }) });
      const made = started.output_photo_id ?? (await waitForJob<{ output_photo_id: number }>(started.job_id!, (value) => setBusy(value))).output_photo_id;
      store.addMedia(await getPhoto(made));
      store.change(applyAtmosphere(store.timeline!, clipId, made, preset, strength));
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Atmosphere')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(420px, calc(100vw - 24px))' }}>
      <h2><CloudFog size={16}/> {t('Atmosphere')}</h2>
      <p className="ed-tip">{t('Mist, haze or fog laid into the scene by distance: thick far away, clear on the people in front.')}</p>
      <div className="ed-chips" role="group" aria-label={t('Atmosphere')}>{ATMOSPHERE_PRESETS.map((each) => <button key={each.id} className={preset === each.id ? 'on' : ''} aria-pressed={preset === each.id} title={t(each.about)} disabled={busy !== null} onClick={() => setPreset(each.id)}>{t(each.label)}</button>)}</div>
      <p className="ed-tip">{t(ATMOSPHERE_PRESETS.find((each) => each.id === preset)!.about)}</p>
      <h3 className="ed-sub">{t('How thick')}</h3>
      <div className="ed-chips" role="group" aria-label={t('How thick')}>{(['light', 'medium', 'heavy'] as const).map((each) => <button key={each} className={strength === each ? 'on' : ''} aria-pressed={strength === each} disabled={busy !== null} onClick={() => setStrength(each)}>{t(each === 'light' ? 'Light' : each === 'medium' ? 'Medium' : 'Heavy')}</button>)}</div>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Laying in the air…')} {busy ? `${Math.round(busy)}%` : ''} · {t('You can keep editing; it continues in Jobs.')}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        {clip.atmosphere && <button className="ed-button" disabled={busy !== null} onClick={() => { store.change(removeAtmosphere(store.timeline!, clipId)); onClose(); }}>{t('Remove atmosphere')}</button>}
        <button className="ed-button primary" disabled={busy !== null || Boolean(cannotAtmosphere(clip))} onClick={() => { void apply(); }}>{t('Apply atmosphere')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
