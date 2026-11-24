/**
 * Day for night: a daytime shot turned into a believable night in one click (moonlit, or deep night), the people kept
 * readable. A look like the others, so it stacks (a starry sky, mist, the lens). Remove puts the original back.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Moon, LoaderCircle } from 'lucide-react';
import { t } from '../i18n';
import { NIGHT_MOODS, type NightMood } from '../timeline/night';
import { findClip } from '../timeline/model';
import { restyle } from './looks';
import { EditorContext } from './state/EditorContext';
import { cannotLook, looksOf, withLook, withoutLook } from '../timeline/stack';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:night';
export function openNight(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function NightHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline || !findClip(store.timeline, clipId)) return null;
  return createPortal(<NightDialog clipId={clipId} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function NightDialog({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const [preset, setPreset] = useState<NightMood>(clip.night?.mood ?? 'moonlit');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(cannotLook(clip, 'night'));
  useEscape(true, () => { if (busy === null) onClose(); });
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      // Added on top of the clip's other looks (or changing this one), all in their order (timeline/stack.ts).
      await restyle(store, clipId, withLook(looksOf(clip), { kind: 'night', mood: preset }), setBusy);
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const takeOff = async () => {
    setError(null); setBusy(0);
    try { await restyle(store, clipId, withoutLook(looksOf(clip), 'night'), setBusy); onClose(); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };

  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Day for night')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(420px, calc(100vw - 24px))' }}>
      <h2><Moon size={16}/> {t('Day for night')}</h2>
      <p className="ed-tip">{t('A daytime shot turned to night: the sky deep blue, the distance sinking into darkness, the people still readable, as if lit by the moon.')}</p>
      <div className="ed-chips" role="group" aria-label={t('Day for night')}>{NIGHT_MOODS.map((each) => <button key={each.id} className={preset === each.id ? 'on' : ''} aria-pressed={preset === each.id} title={t(each.about)} disabled={busy !== null} onClick={() => setPreset(each.id)}>{t(each.label)}</button>)}</div>
      <p className="ed-tip">{t(NIGHT_MOODS.find((each) => each.id === preset)!.about)}</p>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Turning it to night…')} {busy ? `${Math.round(busy)}%` : ''} · {t('You can keep editing; it continues in Jobs.')}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        {clip.night && <button className="ed-button" disabled={busy !== null} onClick={() => { void takeOff(); }}>{t('Back to day')}</button>}
        <button className="ed-button primary" disabled={busy !== null || Boolean(cannotLook(clip, 'night'))} onClick={() => { void apply(); }}>{t('Make it night')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
