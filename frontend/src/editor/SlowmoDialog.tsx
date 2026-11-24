/**
 * Smooth slow motion, one click: ½, ¼ or ⅛ speed with new frames made between the clip's own, so it never stutters.
 * Made once (it shows in Jobs); Normal speed puts the original back. Slowed clips are silent: put music under them.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gauge, LoaderCircle } from 'lucide-react';
import { t } from '../i18n';
import { findClip } from '../timeline/model';
import { SLOW_FACTORS, slowPart, type SlowFactor } from '../timeline/slowmo';
import { restyle } from './looks';
import { EditorContext } from './state/EditorContext';
import { cannotLook, looksOf, withLook, withoutLook } from '../timeline/stack';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:slowmo';
export function openSlowmo(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function SlowmoHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline || !findClip(store.timeline, clipId)) return null;
  return createPortal(<SlowmoDialog clipId={clipId} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function SlowmoDialog({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const [factor, setFactor] = useState<SlowFactor>(clip.slowmo?.factor ?? 4);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(clip.slowmo ? null : cannotLook(clip, 'slowmo'));
  useEscape(true, () => { if (busy === null) onClose(); });
  const part = slowPart(clip);
  const apply = async () => {
    setError(null); setBusy(0);
    try {
      // Added on top of the clip's other looks (or changing this one), all in their order (timeline/stack.ts).
      await restyle(store, clipId, withLook(looksOf(clip), { kind: 'slowmo', factor }), setBusy);
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const takeOff = async () => {
    setError(null); setBusy(0);
    try { await restyle(store, clipId, withoutLook(looksOf(clip), 'slowmo'), setBusy); onClose(); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };

  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Smooth slow motion')} onClick={() => { if (busy === null) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(400px, calc(100vw - 24px))' }}>
      <h2><Gauge size={16}/> {t('Smooth slow motion')}</h2>
      <p className="ed-tip">{t('Kanaa makes new frames between the clip’s own, so slow motion stays silky instead of stuttering.')}</p>
      <div className="ed-chips" role="group" aria-label={t('Speed')}>{SLOW_FACTORS.map((each) => <button key={each.id} className={factor === each.id ? 'on' : ''} aria-pressed={factor === each.id} title={t(each.about)} disabled={busy !== null} onClick={() => setFactor(each.id)}>{t(each.label)}</button>)}</div>
      <p className="ed-tip">{t('{seconds} s becomes {longer} s. Slowed clips are silent: put your song under them.', { seconds: (part.end - part.start).toFixed(1), longer: ((part.end - part.start) * factor).toFixed(1) })}</p>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Making the slow motion…')} {busy ? `${Math.round(busy)}%` : ''} · {t('You can keep editing; it continues in Jobs.')}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions">
        {clip.slowmo && <button className="ed-button" disabled={busy !== null} onClick={() => { void takeOff(); }}>{t('Normal speed')}</button>}
        <button className="ed-button primary" disabled={busy !== null || Boolean(!clip.slowmo && cannotLook(clip, 'slowmo'))} onClick={() => { void apply(); }}>{t('Slow it down')}</button>
        <button className="ed-button" disabled={busy !== null} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
