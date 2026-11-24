/**
 * Cinematic lens: real depth of field on a clip, one click: Portrait, Dreamy, or a rack focus (near → far, far → near),
 * Soft / Medium / Strong. Kanaa makes the lens copy once (it shows in Jobs); Remove lens puts the original back.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Aperture, LoaderCircle } from 'lucide-react';
import { t } from '../i18n';
import { LENS_PRESETS, type LensPreset, type LensStrength } from '../timeline/lens';
import { findClip } from '../timeline/model';
import { restyle } from './looks';
import { EditorContext } from './state/EditorContext';
import { cannotLook, looksOf, withLook, withoutLook } from '../timeline/stack';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:lens';
export function openLens(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function LensHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline || !findClip(store.timeline, clipId)) return null;
  return createPortal(<LensDialog clipId={clipId} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function LensDialog({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const [preset, setPreset] = useState<LensPreset>(clip.lens?.preset ?? 'portrait');
  const [strength, setStrength] = useState<LensStrength>(clip.lens?.strength ?? 'medium');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(cannotLook(clip, 'lens'));
  useEscape(true, () => { if (busy === null) onClose(); });
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      // Added on top of the clip's other looks (or changing this one), all in their order (timeline/stack.ts).
      await restyle(store, clipId, withLook(looksOf(clip), { kind: 'lens', preset, strength }), setBusy);
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const takeOff = async () => {
    setError(null); setBusy(0);
    try { await restyle(store, clipId, withoutLook(looksOf(clip), 'lens'), setBusy); onClose(); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };

  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Cinematic lens')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(420px, calc(100vw - 24px))' }}>
      <h2><Aperture size={16}/> {t('Cinematic lens')}</h2>
      <p className="ed-tip">{t('Real depth of field, worked out from how far away everything is: like shooting on a big cinema lens.')}</p>
      <div className="ed-chips" role="group" aria-label={t('Lens')}>{LENS_PRESETS.map((each) => <button key={each.id} className={preset === each.id ? 'on' : ''} aria-pressed={preset === each.id} title={t(each.about)} disabled={busy !== null} onClick={() => setPreset(each.id)}>{t(each.label)}</button>)}</div>
      <p className="ed-tip">{t(LENS_PRESETS.find((each) => each.id === preset)!.about)}</p>
      <h3 className="ed-sub">{t('Blur')}</h3>
      <div className="ed-chips" role="group" aria-label={t('Blur')}>{(['soft', 'medium', 'strong'] as const).map((each) => <button key={each} className={strength === each ? 'on' : ''} aria-pressed={strength === each} disabled={busy !== null} onClick={() => setStrength(each)}>{t(each === 'soft' ? 'Soft' : each === 'medium' ? 'Medium' : 'Strong')}</button>)}</div>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Making the lens copy…')} {busy ? `${Math.round(busy)}%` : ''} · {t('You can keep editing; it continues in Jobs.')}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        {clip.lens && <button className="ed-button" disabled={busy !== null} onClick={() => { void takeOff(); }}>{t('Remove lens')}</button>}
        <button className="ed-button primary" disabled={busy !== null || Boolean(cannotLook(clip, 'lens'))} onClick={() => { void apply(); }}>{t('Apply lens')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
