/**
 * Real motion blur: the smear of a film camera's shutter on what moves (natural film, dreamy smear, crisp action). A look
 * like the others, applied last (after slow motion too). Remove puts the original back.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wind, LoaderCircle } from 'lucide-react';
import { t } from '../i18n';
import { BLUR_PRESETS, type BlurPreset } from '../timeline/motionblur';
import { findClip } from '../timeline/model';
import { restyle } from './looks';
import { TuneSection, type Tune } from './TuneSection';
import { EditorContext } from './state/EditorContext';
import { cannotLook, looksOf, withLook, withoutLook } from '../timeline/stack';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:blur';
export function openBlur(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function BlurHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline || !findClip(store.timeline, clipId)) return null;
  return createPortal(<BlurDialog clipId={clipId} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function BlurDialog({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const [preset, setPreset] = useState<BlurPreset>(clip.motion_blur?.preset ?? 'natural');
  const [tune, setTune] = useState<Tune>(clip.motion_blur?.tune ?? {});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(cannotLook(clip, 'blur'));
  useEscape(true, () => { if (busy === null) onClose(); });
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      // Added on top of the clip's other looks (or changing this one), all in their order (timeline/stack.ts).
      await restyle(store, clipId, withLook(looksOf(clip), { kind: 'blur', preset, ...(Object.keys(tune).length ? { tune } : {}) }), setBusy);
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const takeOff = async () => {
    setError(null); setBusy(0);
    try { await restyle(store, clipId, withoutLook(looksOf(clip), 'blur'), setBusy); onClose(); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };

  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Motion blur')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(420px, calc(100vw - 24px))' }}>
      <h2><Wind size={16}/> {t('Motion blur')}</h2>
      <p className="ed-tip">{t('The smear a film camera gives what moves: fast pans and movement flow instead of stuttering; still parts stay sharp.')}</p>
      <div className="ed-chips" role="group" aria-label={t('Motion blur')}>{BLUR_PRESETS.map((each) => <button key={each.id} className={preset === each.id ? 'on' : ''} aria-pressed={preset === each.id} title={t(each.about)} disabled={busy !== null} onClick={() => setPreset(each.id)}>{t(each.label)}</button>)}</div>
      <p className="ed-tip">{t(BLUR_PRESETS.find((each) => each.id === preset)!.about)}</p>
      <TuneSection look="blur" preset={preset} tune={tune} onChange={setTune} disabled={busy !== null}/>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Adding the motion blur…')} {busy ? `${Math.round(busy)}%` : ''} · {t('You can keep editing; it continues in Jobs.')}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        {clip.motion_blur && <button className="ed-button" disabled={busy !== null} onClick={() => { void takeOff(); }}>{t('Remove motion blur')}</button>}
        <button className="ed-button primary" disabled={busy !== null || Boolean(cannotLook(clip, 'blur'))} onClick={() => { void apply(); }}>{t('Add motion blur')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
