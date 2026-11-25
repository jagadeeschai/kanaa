/**
 * Shot-to-shot colour match: this clip takes on the colour of the hero shot you pick (or, from the hero, every other clip
 * on the main track takes on its colour), with How strongly and Protect skin tones to tune. A look like the others
 * (timeline/stack.ts): made first, under any sky, mist or lens. Nothing changes until Apply; ⌘Z undoes each clip.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Palette } from 'lucide-react';
import { photoThumbUrl } from '../api/client';
import { t } from '../i18n';
import { findClip, mainLayer, type Clip } from '../timeline/model';
import { cannotLook, looksOf, withLook, type Part } from '../timeline/stack';
import { restyle } from './looks';
import { EditorContext, type EditorStore } from './state/EditorContext';
import { TuneSection, type Tune } from './TuneSection';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:match';
/** `others`: this clip is the hero, and the other clips are matched to it. */
export function openMatch(clipId: string, others = false) { window.dispatchEvent(new CustomEvent(OPEN, { detail: { clipId, others } })); }

/** The hero's colour as it shows now (with any looks it has): what the others are matched to. */
const shown = (clip: Clip): Part => ({ media: clip.media_id, start: clip.in, end: clip.out });

export function MatchHost() {
  const store = useContext(EditorContext);
  const [open, setOpen] = useState<{ clipId: string; others: boolean } | null>(null);
  useEffect(() => {
    const show = (event: Event) => setOpen((event as CustomEvent<{ clipId: string; others: boolean }>).detail);
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);
  if (!open || !store?.timeline || !findClip(store.timeline, open.clipId)) return null;
  return createPortal(<MatchDialog clipId={open.clipId} others={open.others} onClose={() => setOpen(null)}/>, document.querySelector('.ed') ?? document.body);
}

function MatchDialog({ clipId, others, onClose }: { clipId: string; others: boolean; onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const live = useRef<EditorStore>(store);
  live.current = store;  // Each clip is matched from the timeline as it is then, not as it was when this opened.
  const clip = findClip(store.timeline!, clipId)!;
  const candidates = mainLayer(store.timeline!).items.filter((item) => item.id !== clipId && !item.freeze3d && item.freeze == null);
  const [hero, setHero] = useState<string | null>(clip.colour_match ? candidates.find((item) => item.media_id === clip.colour_match!.reference_media_id)?.id ?? null : null);
  const [tune, setTune] = useState<Tune>(clip.colour_match?.tune ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscape(true, () => { if (!busy) onClose(); });
  const targets = others ? candidates.filter((item) => !cannotLook(item, 'match')) : [];
  const apply = async () => {
    setError(null);
    try {
      if (others) {
        const reference = shown(findClip(live.current.timeline!, clipId)!);
        for (const [index, target] of targets.entries()) {
          const now = findClip(live.current.timeline!, target.id);
          if (!now) continue;
          await restyle(live.current, target.id, withLook(looksOf(now), { kind: 'match', reference, ...(Object.keys(tune).length ? { tune } : {}) }),
            (progress) => setBusy(`${t('Matching clip')} ${index + 1} / ${targets.length}… ${Math.round(progress)}%`));
          await new Promise((resolve) => setTimeout(resolve, 50));  // Let the editor take the change before the next.
        }
      } else {
        const heroClip = findClip(live.current.timeline!, hero!);
        if (!heroClip) throw new Error(t('Choose the shot to match to.'));
        await restyle(live.current, clipId, withLook(looksOf(findClip(live.current.timeline!, clipId)!), { kind: 'match', reference: shown(heroClip), ...(Object.keys(tune).length ? { tune } : {}) }),
          (progress) => setBusy(`${t('Matching the colour…')} ${Math.round(progress)}%`));
      }
      onClose();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const blocked = cannotLook(clip, 'match');
  return <div className="ed-modal ed-ai-edit-modal" role="dialog" aria-modal="true" aria-label={t('Match colour')} onClick={() => { if (!busy) onClose(); }}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(440px, calc(100vw - 24px))' }}>
      <h2><Palette size={16}/> {t(others ? 'Match the other clips to this one' : 'Match colour')}</h2>
      <p className="ed-tip">{t(others ? 'Every other clip on the main track takes on this clip’s colour, as if shot together.' : 'This clip takes on the colour of the shot you pick, as if shot together.')}</p>
      {!others && <>
        <h3 className="ed-sub">{t('Match to')}</h3>
        {candidates.length ? <div className="ed-youtube-pictures ed-clone-takes" role="group" aria-label={t('Match to')}>
          {candidates.map((item) => <button key={item.id} className={hero === item.id ? 'on' : ''} aria-pressed={hero === item.id} disabled={Boolean(busy)} title={item.name ?? ''}
            onClick={() => setHero(item.id)}><img src={photoThumbUrl(item.media_id)} alt=""/></button>)}
        </div> : <p className="ed-tip">{t('Add the shot you want to match to on the main track first.')}</p>}
      </>}
      {others && <p className="ed-tip">{targets.length} {t('clips will be matched.')}</p>}
      <TuneSection look="match" preset="default" tune={tune} onChange={setTune} disabled={Boolean(busy)}/>
      {busy && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {busy}</p>}
      {(error || blocked) && <p className="ed-error" role="alert">{error ?? t(blocked!)}</p>}
      <div className="ed-ai-edit-actions">
        <button className="ed-button primary" disabled={Boolean(busy) || Boolean(blocked) || (others ? !targets.length : !hero)} onClick={() => { void apply(); }}>{t(others ? 'Match them' : 'Match colour')}</button>
        <button className="ed-button" disabled={Boolean(busy)} onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
