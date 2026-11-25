/**
 * ✨ Make it cinematic: the AI director (director_service.py, the vision model in AI settings) looks the clip over and
 * suggests looks with their tuning, each with a reason; Apply makes them through the stack (timeline/stack.ts), and
 * Check the result has it judge the result and correct it. Nothing changes until the person presses Apply; ⌘Z undoes.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { requestJson, waitForJob } from '../api/client';
import { t } from '../i18n';
import { describeLook, looksToMake, type Plan } from '../timeline/director';
import { findClip } from '../timeline/model';
import { cannotLook, looksOf, originalPart } from '../timeline/stack';
import { restyle } from './looks';
import { EditorContext } from './state/EditorContext';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:director';
export function openDirector(clipId: string) { window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId })); }

export function DirectorHost() {
  const store = useContext(EditorContext);
  const [clipId, setClipId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setClipId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (!clipId || !store?.timeline || !findClip(store.timeline, clipId)) return null;
  return createPortal(<DirectorDialog clipId={clipId} onClose={() => setClipId(null)}/>, document.querySelector('.ed') ?? document.body);
}

function DirectorDialog({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const clip = findClip(store.timeline!, clipId)!;
  const [wish, setWish] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState<{ what: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(cannotLook(clip, 'atmosphere'));
  useEscape(true, () => { if (!busy) onClose(); });
  const part = originalPart(clip);
  const ask = async (review: boolean) => {
    setError(null); setBusy({ what: review ? 'Checking the result…' : 'Looking the clip over…', progress: 0 });
    try {
      const now = findClip(store.timeline!, clipId)!;
      const body = { media_id: part.media, start: part.start, end: part.end, wish, ...(review ? { review: { result_media_id: now.media_id, looks: looksOf(now) } } : {}) };
      const started = await requestJson<{ job_id: string }>('/api/director', { method: 'POST', body: JSON.stringify(body) });
      const answer = await waitForJob<Plan>(started.job_id, (progress) => setBusy((was) => (was ? { ...was, progress } : was)));
      setPlan({ looks: answer.looks ?? [], summary: answer.summary ?? '', verdict: answer.verdict });
      if (!review) setApplied(false);
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const apply = async () => {
    if (!plan) return;
    setError(null); setBusy({ what: 'Making the looks…', progress: 0 });
    try { await restyle(store, clipId, looksToMake(plan), (progress) => setBusy({ what: 'Making the looks…', progress })); setApplied(true); setPlan({ ...plan, verdict: undefined }); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const good = plan?.verdict === 'good';
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Make it cinematic')} onClick={() => { if (!busy) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(460px, calc(100vw - 24px))' }}>
      <h2><Sparkles size={16}/> {t('Make it cinematic')}</h2>
      <p className="ed-tip">{t('The AI director looks this clip over and suggests cinematic looks, tuned for it. Nothing changes until you press Apply.')}</p>
      <label className="field-label">{t('What feeling? (optional)')}
        <input value={wish} maxLength={300} placeholder={t('e.g. a quiet misty morning, a golden evening')} disabled={Boolean(busy)} onChange={(event) => setWish(event.target.value)}/></label>
      {plan && <div className="ed-director-plan" role="status">
        {plan.verdict && <p className="ed-tip"><b>{t(good ? 'The result looks right.' : 'Suggested changes:')}</b></p>}
        {plan.summary && <p className="ed-tip">{plan.summary}</p>}
        {plan.looks.length ? <ol>{plan.looks.map((look) => <li key={look.kind}><b>{describeLook(look)}</b>{look.why ? <><br/><small>{look.why}</small></> : null}</li>)}</ol>
          : <p className="ed-tip">{t('No looks: the director thinks this clip already looks right.')}</p>}
      </div>}
      {busy && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t(busy.what)} {busy.progress ? `${Math.round(busy.progress)}%` : ''}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <p className="ed-tip"><small>{t('Sends what Kanaa sees in the clip and three small pictures of it to the AI provider in AI settings.')}</small></p>
      <div className="ed-ai-edit-actions">
        {plan && plan.looks.length > 0 && !good && (!applied || plan.verdict === 'adjust') && <button className="ed-button primary" disabled={Boolean(busy)} onClick={() => { void apply(); }}>{t(plan.verdict === 'adjust' ? 'Apply the changes' : 'Apply')}</button>}
        {applied && <button className="ed-button" disabled={Boolean(busy)} onClick={() => { void ask(true); }}>{t('Check the result')}</button>}
        <button className={`ed-button ${plan ? '' : 'primary'}`} disabled={Boolean(busy) || Boolean(cannotLook(clip, 'atmosphere'))} onClick={() => { void ask(false); }}>{t(plan ? 'Suggest again' : 'Suggest looks')}</button>
        <button className="ed-button" disabled={Boolean(busy)} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
