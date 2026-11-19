/**
 * Smart slice: Kanaa looks at the end of a clip and slices it the way that suits it, with no choices to make.
 * A picture with people: they and the scene split apart (Pop-out's cut-out and the scene filled behind them).
 * Otherwise, with a clear subject (faces, or the picture's most striking part): two pieces, cut beside it, never through it.
 * Otherwise (a landscape): slices across the scene, in opposite ways. One undo takes it back.
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Scissors } from 'lucide-react';
import { findPeople, getFocus, getPhoto, startPopout, waitForJob } from '../api/client';
import { t } from '../i18n';
import { findClip, mainLayer } from '../timeline/model';
import { cutBeside, sliceAroundPeople, sliceIntoPieces, SLICE_SECONDS } from '../timeline/slice';
import { newId } from './editor-constants';
import { EditorContext } from './state/EditorContext';
import { useEscape } from './useEscape';

const OPEN = 'kanaa:smart-slice';
type Target = { clipId: string; mediaId: number };

/** Opens Smart slice for a main-track clip. */
export function openSmartSlice(target: Target) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: target }));
}

export function SmartSliceHost() {
  const store = useContext(EditorContext);
  const [target, setTarget] = useState<Target | null>(null);
  const [status, setStatus] = useState(''), [progress, setProgress] = useState<number | null>(null), [done, setDone] = useState<string | null>(null), [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = (event: Event) => { setTarget((event as CustomEvent<Target>).detail); setDone(null); setError(null); setProgress(null); setStatus(''); };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);

  useEffect(() => {
    if (!target || !store?.timeline) return;
    let cancelled = false;
    const run = async () => {
      const timeline = store.timeline!;
      const clip = findClip(timeline, target.clipId);
      if (!clip || !mainLayer(timeline).items.includes(clip)) { setError(t('Slice a clip on the main track.')); return; }
      const media = await getPhoto(target.mediaId);
      const facts = { media_id: media.id, media_type: media.media_type === 'video' ? 'video' as const : 'image' as const, duration: media.duration };
      // B: a picture with people, when this Mac can fill in behind them.
      if (media.media_type === 'image') {
        try {
          setStatus(t('Looking for people…'));
          const found = await findPeople(media.id, 'people');
          if (found.count > 0 && found.local) {
            setStatus(t('Cutting out the people and filling the scene behind them…')); setProgress(0);
            const { job_id } = await startPopout(media.id, Array.from({ length: found.count }, (_, index) => index + 1), 'people');
            const made = await waitForJob<{ background_id: number; person_id: number; where: { x: number; top: number; bottom: number; left: number; right: number } }>(job_id, (value) => { if (!cancelled) setProgress(value); });
            const [background, person] = await Promise.all([getPhoto(made.background_id), getPhoto(made.person_id)]);
            if (cancelled) return;
            store.addMedia(background); store.addMedia(person);
            store.change(sliceAroundPeople(store.timeline!, clip.id, { backgroundId: background.id, personId: person.id, where: made.where }, newId), 'slice');
            setDone(t(found.count === 1 ? 'The person rises out while the scene splits apart behind them.' : 'The people rise out while the scene splits apart behind them.'));
            return;
          }
        } catch { /* No people, or no cut-out on this Mac: slice beside the subject instead. */ }
      }
      // A: two pieces, cut beside the subject; or, with none, slices across the scene.
      setStatus(t('Finding the subject…')); setProgress(null);
      const focus = await getFocus(media.id, media.media_type === 'video' ? Math.max(0, clip.out - 0.05) : 0).catch(() => ({ x: null, y: null }));
      if (cancelled) return;
      if (focus.x !== null) {
        store.change(sliceIntoPieces(store.timeline!, clip.id, 'sideways', facts, newId, SLICE_SECONDS, cutBeside(focus.x)), 'slice');
        setDone(t('Two pieces, cut beside the subject so it stays whole, slide apart.'));
      } else {
        store.change(sliceIntoPieces(store.timeline!, clip.id, 'opposite', facts, newId), 'slice');
        setDone(t('Three slices across the scene slide away in opposite directions.'));
      }
    };
    run().catch((problem) => { if (!cancelled) setError((problem as Error).message); });
    return () => { cancelled = true; };
  }, [target]);  // eslint-disable-line react-hooks/exhaustive-deps

  const working = !done && !error;
  useEscape(Boolean(target), () => { if (!working) setTarget(null); });
  if (!target || !store) return null;
  const close = () => { if (!working) setTarget(null); };
  return createPortal(<div className="ed-modal" role="dialog" aria-modal="true" aria-label={t('Smart slice')} onClick={close}>
    <div className="ed-card small" onClick={(event) => event.stopPropagation()} style={{ width: 'min(380px, calc(100vw - 24px))' }}>
      <h2><Scissors size={16}/> {t('Smart slice')}</h2>
      {working && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {status || t('Looking at the picture…')}{progress !== null ? ` ${Math.round(progress)}%` : ''}</p>}
      {done && <><p role="status">{done}</p><p className="ed-tip">{t('Each piece is its own layer: change its move in Animate. ⌘Z undoes it.')}</p></>}
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="ed-ai-edit-actions"><button className="ed-primary" disabled={working} onClick={() => setTarget(null)}>{t('Done')}</button></div>
    </div>
  </div>, document.body);
}

