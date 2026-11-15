/**
 * Create video with AI: a few seconds of video from a description alone (text-to-video), in the project's shape.
 * Add it to the end of the timeline, or keep it in Media. Uses the video AI set in AI settings → Video.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, LoaderCircle } from 'lucide-react';
import { getPhoto, photoVideoUrl, startTextToVideo, waitForJob } from '../api/client';
import type { Photo } from '../types/photo';
import { EditorContext } from './state/EditorContext';
import { t } from '../i18n';

const OPEN = 'kanaa-text-to-video';
type Request = { addToTimeline: (item: Photo) => void; folder: string | null };

export function openTextToVideo(request: Request) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: request }));
}

/** The project's shape, for the video's frame. */
export function shapeOf(format: { width: number; height: number }): 'landscape' | 'portrait' | 'square' {
  return format.width > format.height * 1.1 ? 'landscape' : format.height > format.width * 1.1 ? 'portrait' : 'square';
}

const IDEAS = ['A village temple at dawn, mist over the pond, slow camera glide', 'Monsoon rain on a coconut grove, warm evening light',
  'Lamps floating on a river at night, gentle drift', 'A palm-leaf manuscript, pages turning in candlelight'];

export function TextToVideoHost() {
  const store = useContext(EditorContext);
  const [request, setRequest] = useState<Request | null>(null);
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(5);
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => { setRequest((event as CustomEvent<Request>).detail); setResult(null); setError(null); setBusy(null); };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!request || !store?.timeline) return null;
  const shape = shapeOf(store.timeline.format);
  const close = () => { if (busy === null) setRequest(null); };
  const run = async () => {
    setError(null); setResult(null); setBusy(0);
    try {
      const { job_id } = await startTextToVideo({ prompt, seconds, shape, folder: request.folder });
      const done = await waitForJob<{ media_id: number }>(job_id, (progress) => setBusy(progress));
      const made = await getPhoto(done.media_id);
      store.addMedia(made);
      setResult(made);
    } catch (problem) { setError((problem as Error).message); }
    setBusy(null);
  };
  return createPortal(<div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Create video with AI')} onClick={close}>
    <div className="ed-card ed-ai-edit" onClick={(event) => event.stopPropagation()}>
      <h2><Clapperboard size={16}/> {t('Create video with AI')}</h2>
      <div className="ed-ai-edit-single">{result ? <video src={photoVideoUrl(result.id)} autoPlay loop muted playsInline/> : <div className="ed-ai-edit-wait">{busy !== null ? <><LoaderCircle className="spin" size={18}/>{t('Making the video…')} {busy ? `${busy}%` : ''}</> : t('Describe a scene; the video shows here')}</div>}</div>
      <textarea value={prompt} maxLength={2000} rows={3} autoFocus disabled={busy !== null} placeholder={t('Describe the scene and how the camera moves')} onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && prompt.trim()) void run(); }}/>
      {!prompt && <div className="ed-chips">{IDEAS.map((idea) => <button key={idea} onClick={() => setPrompt(t(idea))}>{t(idea)}</button>)}</div>}
      <label className="ed-ai-seconds">{t('Length')} <select value={seconds} disabled={busy !== null} onChange={(event) => setSeconds(Number(event.target.value))}>{[5, 10, 15].map((s) => <option key={s} value={s}>{s} s</option>)}</select><span>· {t(shape === 'landscape' ? 'Landscape, like this video' : shape === 'portrait' ? 'Portrait, like this video' : 'Square, like this video')}</span></label>
      {error && <p className="ed-error" role="alert">{error}</p>}
      <p className="ed-tip">{t('Your description goes to the video AI in AI settings → Video, and uses its credits. It comes back silent: your song stays the soundtrack.')}</p>
      <div className="ed-ai-edit-actions">
        {result && <button className="ed-button primary" onClick={() => { request.addToTimeline(result); setRequest(null); }}>{t('Add to timeline')}</button>}
        <button className={`ed-button ${result ? '' : 'primary'}`} disabled={busy !== null || !prompt.trim()} onClick={() => void run()}>{result ? t('Try again') : t('Make video')}</button>
        {result && <button className="ed-button" onClick={() => setRequest(null)}>{t('Keep in media')}</button>}
        <button className="ed-button" disabled={busy !== null} onClick={close}>{t('Close')}</button>
      </div>
    </div>
  </div>, document.querySelector('.ed') ?? document.body);
}
