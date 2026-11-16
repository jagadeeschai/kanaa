/**
 * Edit with AI: right-click a picture on the timeline, say what to change, see the original and the AI's picture side
 * by side, then put it in the clip's place, try again, or keep both. The original picture is never changed.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from './useEscape';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { getPhoto, photoThumbUrl, startAiEdit, waitForJob } from '../api/client';
import { findClip, updateClip } from '../timeline/model';
import { EditorContext } from './state/EditorContext';
import { t } from '../i18n';

const OPEN = 'kanaa-ai-edit';
type Target = { clipId: string; mediaId: number };

export function openAiEdit(target: Target) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: target }));
}

const IDEAS = ['Make it a golden sunset', 'Rainy evening with soft lights', 'Add a temple in the distance', 'Turn it into a painting'];

export function AiEditHost() {
  const store = useContext(EditorContext);
  const [target, setTarget] = useState<Target | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<number | null>(null);  // Progress while the AI works.
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => { setTarget((event as CustomEvent<Target>).detail); setResult(null); setError(null); setBusy(null); };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  useEscape(Boolean(target), () => { if (busy === null) setTarget(null); });
  if (!target || !store) return null;
  const close = () => { if (busy === null) setTarget(null); };
  const run = async () => {
    setError(null); setResult(null); setBusy(0);
    try {
      const { job_id } = await startAiEdit(target.mediaId, prompt);
      const done = await waitForJob<{ media_id: number }>(job_id, (progress) => setBusy(progress));
      setResult(done.media_id);
      store.addMedia(await getPhoto(done.media_id));  // In the media list and ready to play, whatever is chosen.
    } catch (problem) { setError((problem as Error).message); }
    setBusy(null);
  };
  const replace = () => {
    const timeline = store.timeline;
    if (!timeline || result === null || !findClip(timeline, target.clipId)) return;
    store.change(updateClip(timeline, target.clipId, { media_id: result }));
    setTarget(null);
  };
  // Drawn at the editor's top (not inside the preview), so it sits above the timeline at every width.
  return createPortal(<div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Edit with AI')} onClick={close}>
    <div className="ed-card ed-ai-edit" onClick={(event) => event.stopPropagation()}>
      <h2><Sparkles size={16}/> {t('Edit with AI')}</h2>
      <div className="ed-ai-edit-pair">
        <figure><img src={photoThumbUrl(target.mediaId)} alt=""/><figcaption>{t('Now')}</figcaption></figure>
        <figure>{result !== null ? <img src={photoThumbUrl(result)} alt=""/> : <div className="ed-ai-edit-wait">{busy !== null ? <><LoaderCircle className="spin" size={18}/>{t('Drawing…')} {busy ? `${busy}%` : ''}</> : t('The edited picture shows here')}</div>}<figcaption>{t('With AI')}</figcaption></figure>
      </div>
      <textarea value={prompt} maxLength={1500} rows={3} autoFocus disabled={busy !== null} placeholder={t('Say what to change, e.g. make it a golden sunset')} onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && prompt.trim()) void run(); }}/>
      {!prompt && <div className="ed-chips">{IDEAS.map((idea) => <button key={idea} onClick={() => setPrompt(t(idea))}>{t(idea)}</button>)}</div>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <p className="ed-tip">{t('Your picture and request are sent to the AI service in AI settings. The original stays as it is.')}</p>
      <div className="ed-ai-edit-actions">
        {result !== null && <button className="ed-button primary" onClick={replace}>{t('Replace in timeline')}</button>}
        <button className={`ed-button ${result === null ? 'primary' : ''}`} disabled={busy !== null || !prompt.trim()} onClick={() => void run()}>{result === null ? t('Edit picture') : t('Try again')}</button>
        {result !== null && <button className="ed-button" onClick={() => setTarget(null)}>{t('Keep both')}</button>}
        <button className="ed-button" disabled={busy !== null} onClick={close}>{t('Close')}</button>
      </div>
    </div>
  </div>, document.querySelector('.ed') ?? document.body);
}
