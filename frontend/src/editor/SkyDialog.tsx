/**
 * Sky swap: a new sky in one click (golden sunset, starry night, storm clouds, clear blue), the land relit to match,
 * following the camera. Kanaa makes the copy once (it shows in Jobs); Remove new sky puts the original back.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloudSun, LoaderCircle } from 'lucide-react';
import { t } from '../i18n';
import { SKY_CHOICES, type SkyChoice } from '../timeline/sky';
import { findClip } from '../timeline/model';
import { restyle } from './looks';
import { EditorContext } from './state/EditorContext';
import { cannotLook, looksOf, withLook, withoutLook } from '../timeline/stack';
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
  const [error, setError] = useState<string | null>(cannotLook(clip, 'new_sky'));
  useEscape(true, () => { if (busy === null) onClose(); });
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      // Added on top of the clip's other looks (or changing this one), all in their order (timeline/stack.ts).
      await restyle(store, clipId, withLook(looksOf(clip), { kind: 'new_sky', sky: preset }), setBusy);
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const takeOff = async () => {
    setError(null); setBusy(0);
    try { await restyle(store, clipId, withoutLook(looksOf(clip), 'new_sky'), setBusy); onClose(); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
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
        {clip.new_sky && <button className="ed-button" disabled={busy !== null} onClick={() => { void takeOff(); }}>{t('Remove new sky')}</button>}
        <button className="ed-button primary" disabled={busy !== null || Boolean(cannotLook(clip, 'new_sky'))} onClick={() => { void apply(); }}>{t('Apply sky')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
