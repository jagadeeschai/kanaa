/**
 * Match-cut finder: Kanaa looks through the main track's clips for cuts that flow (the same shape, or a movement that
 * carries on) and shows the best, each side by side. Use this cut trims and places them; ⌘Z undoes it.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Scissors } from 'lucide-react';
import { requestJson, waitForJob } from '../api/client';
import { t } from '../i18n';
import { applyMatchCut, isUsed, matchCutClips, matchStrength, type MatchCut } from '../timeline/matchcut';
import { mainLayer } from '../timeline/model';
import { EditorContext } from './state/EditorContext';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:match-cuts';
export function openMatchCuts() { window.dispatchEvent(new CustomEvent(OPEN)); }

export function MatchCutHost() {
  const store = useContext(EditorContext);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);
  if (!open || !store?.timeline) return null;
  return createPortal(<MatchCutDialog onClose={() => setOpen(false)}/>, document.querySelector('.ed') ?? document.body);
}

function MatchCutDialog({ onClose }: { onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const [busy, setBusy] = useState<number | null>(0);
  const [found, setFound] = useState<MatchCut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscape(true, onClose);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const clips = matchCutClips(store.timeline!, () => true);  // Pictures are skipped by the finder itself.
        if (clips.length < 2) throw new Error(t('Add at least two video clips to the main track to find match cuts.'));
        const started = await requestJson<{ job_id: string }>('/api/match-cuts', { method: 'POST', body: JSON.stringify({ clips }) });
        const result = await waitForJob<{ suggestions: MatchCut[] }>(started.job_id, (value) => { if (live) setBusy(value); });
        if (live) setFound(result.suggestions);
      } catch (problem) { if (live) setError((problem as Error).message); } finally { if (live) setBusy(null); }
    })();
    return () => { live = false; };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => mainLayer(store.timeline!).items.find((clip) => clip.id === id)?.name ?? t('Clip') + ' ' + (mainLayer(store.timeline!).items.findIndex((clip) => clip.id === id) + 1);
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Match cuts')} onClick={onClose}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(560px, calc(100vw - 24px))' }}>
      <h2><Scissors size={16}/> {t('Match cuts')}</h2>
      <p className="ed-tip">{t('Cuts that flow: the same shape, or a movement that carries on from one clip into the next.')}</p>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Looking through your clips…')} {busy ? `${Math.round(busy)}%` : ''}</p>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      {found && !found.length && <p className="ed-tip">{t('No strong match cuts in these clips. Try adding more clips of similar shapes or movement.')}</p>}
      {found && found.length > 0 && <div className="ed-match-cuts">
        {found.map((cut) => {
          const used = isUsed(store.timeline!, cut);
          return <div key={`${cut.from}-${cut.to}`} className="ed-match-cut">
            <div className="ed-match-cut-pictures"><img src={cut.from_picture} alt={name(cut.from)}/><span aria-hidden="true">→</span><img src={cut.to_picture} alt={name(cut.to)}/></div>
            <div className="ed-match-cut-about"><b>{t(matchStrength(cut.score))}</b> · {t(cut.why === 'same shape' ? 'Same shape' : cut.why === 'the movement carries on' ? 'The movement carries on' : 'Same shape and movement')}<br/>
              <small>{name(cut.from)} → {name(cut.to)}</small></div>
            <button className={`ed-button ${used ? 'on' : 'primary'}`} disabled={used} onClick={() => store.change(applyMatchCut(store.timeline!, cut))}>{used ? t('Used') : t('Use this cut')}</button>
          </div>;
        })}
      </div>}
      <div className="ed-ai-edit-actions"><button className="ed-button" onClick={onClose}>{t('Close')}</button></div>
    </div>
  </div>;
}
