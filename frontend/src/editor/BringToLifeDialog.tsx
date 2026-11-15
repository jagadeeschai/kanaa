/**
 * Bring to life: right-click a picture on the timeline, say how it should move, and an image-to-video AI makes a few
 * seconds of video from it. See it beside the picture, then put it in the clip's place (fitted to the clip's length,
 * its own sound off), try again, or keep both. The picture itself is never changed.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, LoaderCircle } from 'lucide-react';
import { getPhoto, photoThumbUrl, photoVideoUrl, startBringToLife, waitForJob } from '../api/client';
import { clipLength, findClip, updateClip } from '../timeline/model';
import { EditorContext } from './state/EditorContext';
import { t } from '../i18n';

const OPEN = 'kanaa-bring-to-life';
const MIN_SPEED = 0.25;
type Target = { clipId: string; mediaId: number };

export function openBringToLife(target: Target) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: target }));
}

const IDEAS = ['Slow camera push in', 'Hair and clothes moving in the wind', 'Lamps flickering, light rain', 'Clouds drifting, leaves swaying', 'Gentle smile and blink'];

/** The video's place in the clip: its own length, slowed to fill the clip (never slower than MIN_SPEED). */
export function fitted(clipSeconds: number, videoSeconds: number) {
  const speed = Math.max(MIN_SPEED, Math.min(1, videoSeconds / clipSeconds));
  return { in: 0, out: Math.round(Math.min(videoSeconds, clipSeconds * speed) * 1000) / 1000, speed: Math.round(speed * 10000) / 10000 };
}

export function BringToLifeHost() {
  const store = useContext(EditorContext);
  const [target, setTarget] = useState<Target | null>(null);
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(5);
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<{ id: number; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<Target>).detail;
      setTarget(next); setResult(null); setError(null); setBusy(null);
      // As long as the clip, within what the models make (5 to 15 s); a longer clip plays it slower.
      const clip = store?.timeline ? findClip(store.timeline, next.clipId) : null;
      setSeconds(clip ? Math.max(5, Math.min(15, Math.round(clipLength(clip)))) : 5);
    };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, [store]);
  if (!target || !store) return null;
  const close = () => { if (busy === null) setTarget(null); };
  const run = async () => {
    setError(null); setResult(null); setBusy(0);
    try {
      const { job_id } = await startBringToLife(target.mediaId, prompt, seconds);
      const done = await waitForJob<{ media_id: number }>(job_id, (progress) => setBusy(progress));
      const made = await getPhoto(done.media_id);
      store.addMedia(made);
      setResult({ id: made.id, duration: made.duration ?? seconds });
    } catch (problem) { setError((problem as Error).message); }
    setBusy(null);
  };
  const replace = () => {
    const timeline = store.timeline;
    const clip = timeline && findClip(timeline, target.clipId);
    if (!timeline || !clip || !result) return;
    const place = fitted(clipLength(clip), result.duration);
    // Too short even at a quarter speed: it would shorten the clip and move everything after it. Never do that silently.
    if ((place.out - place.in) / place.speed < clipLength(clip) - 0.01) { setError(t('This clip is more than four times longer than the video. Make a longer video, or split the clip first.')); return; }
    store.change(updateClip(timeline, target.clipId, { media_id: result.id, ...place, muted: true }));
    setTarget(null);
  };
  // Drawn at the editor's top (not inside the preview), so it sits above the timeline at every width.
  return createPortal(<div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Bring to life')} onClick={close}>
    <div className="ed-card ed-ai-edit" onClick={(event) => event.stopPropagation()}>
      <h2><Clapperboard size={16}/> {t('Bring to life')}</h2>
      <div className="ed-ai-edit-pair">
        <figure><img src={photoThumbUrl(target.mediaId)} alt=""/><figcaption>{t('Picture')}</figcaption></figure>
        <figure>{result ? <video src={photoVideoUrl(result.id)} autoPlay loop muted playsInline/> : <div className="ed-ai-edit-wait">{busy !== null ? <><LoaderCircle className="spin" size={18}/>{t('Making the video…')} {busy ? `${busy}%` : ''}</> : t('The moving version shows here')}</div>}<figcaption>{t('Moving')}</figcaption></figure>
      </div>
      <textarea value={prompt} maxLength={1500} rows={3} autoFocus disabled={busy !== null} placeholder={t('Say how it should move, e.g. hair moving in the wind')} onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && prompt.trim()) void run(); }}/>
      {!prompt && <div className="ed-chips">{IDEAS.map((idea) => <button key={idea} onClick={() => setPrompt(t(idea))}>{t(idea)}</button>)}</div>}
      <label className="ed-ai-seconds">{t('Length')} <select value={seconds} disabled={busy !== null} onChange={(event) => setSeconds(Number(event.target.value))}>{[5, 8, 10, 15].map((s) => <option key={s} value={s}>{s} s</option>)}</select></label>
      {error && <p className="ed-error" role="alert">{error}</p>}
      <p className="ed-tip">{t('Your picture and words go to the video AI in AI settings → Video, and use its credits. The picture stays as it is.')}</p>
      <div className="ed-ai-edit-actions">
        {result && <button className="ed-button primary" onClick={replace}>{t('Replace in timeline')}</button>}
        <button className={`ed-button ${result ? '' : 'primary'}`} disabled={busy !== null || !prompt.trim()} onClick={() => void run()}>{result ? t('Try again') : t('Make video')}</button>
        {result && <button className="ed-button" onClick={() => setTarget(null)}>{t('Keep both')}</button>}
        <button className="ed-button" disabled={busy !== null} onClick={close}>{t('Close')}</button>
      </div>
    </div>
  </div>, document.querySelector('.ed') ?? document.body);
}
