/**
 * God rays: beams of light from the sun (soft glow, strong beams, dusty light), blocked by trees and people. A look like
 * the others, so it stacks (after a new sky, so a new sunset's sun casts them). Remove puts the original back.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sun, LoaderCircle } from 'lucide-react';
import { t } from '../i18n';
import { RAYS_PRESETS, type RaysPreset } from '../timeline/rays';
import { findClip } from '../timeline/model';
import { restyle } from './looks';
import { EditorContext } from './state/EditorContext';
import { cannotLook, looksOf, withLook, withoutLook } from '../timeline/stack';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:rays';
export function openRays(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function RaysHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline || !findClip(store.timeline, clipId)) return null;
  return createPortal(<RaysDialog clipId={clipId} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function RaysDialog({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const [preset, setPreset] = useState<RaysPreset>(clip.rays?.preset ?? 'soft');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(cannotLook(clip, 'rays'));
  useEscape(true, () => { if (busy === null) onClose(); });
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      // Added on top of the clip's other looks (or changing this one), all in their order (timeline/stack.ts).
      await restyle(store, clipId, withLook(looksOf(clip), { kind: 'rays', preset }), setBusy);
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const takeOff = async () => {
    setError(null); setBusy(0);
    try { await restyle(store, clipId, withoutLook(looksOf(clip), 'rays'), setBusy); onClose(); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };

  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('God rays')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(420px, calc(100vw - 24px))' }}>
      <h2><Sun size={16}/> {t('God rays')}</h2>
      <p className="ed-tip">{t('Beams of light streaming from the sun across the scene, broken by trees and people where they stand in the way.')}</p>
      <div className="ed-chips" role="group" aria-label={t('God rays')}>{RAYS_PRESETS.map((each) => <button key={each.id} className={preset === each.id ? 'on' : ''} aria-pressed={preset === each.id} title={t(each.about)} disabled={busy !== null} onClick={() => setPreset(each.id)}>{t(each.label)}</button>)}</div>
      <p className="ed-tip">{t(RAYS_PRESETS.find((each) => each.id === preset)!.about)}</p>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Casting the light…')} {busy ? `${Math.round(busy)}%` : ''} · {t('You can keep editing; it continues in Jobs.')}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        {clip.rays && <button className="ed-button" disabled={busy !== null} onClick={() => { void takeOff(); }}>{t('Remove god rays')}</button>}
        <button className="ed-button primary" disabled={busy !== null || Boolean(cannotLook(clip, 'rays'))} onClick={() => { void apply(); }}>{t('Add god rays')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
