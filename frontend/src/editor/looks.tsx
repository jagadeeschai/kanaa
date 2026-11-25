/**
 * Stacking looks in the editor (timeline/stack.ts): making each look from the one before, by its own service, and a
 * small status card while a look is taken off from the menu (the others are rebuilt, from the cache where they can be).
 */
import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle } from 'lucide-react';
import { getPhoto, requestJson, waitForJob } from '../api/client';
import { t } from '../i18n';
import { findClip } from '../timeline/model';
import { looksOf, makeLooks, originalPart, setLooks, withoutLook, type Look, type LookKind, type Part } from '../timeline/stack';
import { EditorContext, type EditorStore } from './state/EditorContext';

const ROUTE: Record<LookKind, string> = { match: 'match', new_sky: 'sky', night: 'night', rays: 'rays', atmosphere: 'atmosphere', lens: 'lens', slowmo: 'slowmo', blur: 'blur', halation: 'halation', shake: 'shake' };

/** Makes one look of one source part; its media id. */
async function makeLook(look: Look, source: Part, part: Part, onProgress: (value: number) => void): Promise<number> {
  const { kind, ...settings } = look;
  // Shake moves the same way for the same original part, whatever looks come before it.
  const original = kind === 'shake' ? { original_media_id: part.media, original_in: part.start, original_out: part.end } : {};
  const started = await requestJson<{ status: string; output_photo_id?: number; job_id?: string }>(`/api/photos/${source.media}/${ROUTE[kind]}`,
    { method: 'POST', body: JSON.stringify({ start: source.start, end: source.end, ...settings, ...original }) });
  return started.output_photo_id ?? (await waitForJob<{ output_photo_id: number }>(started.job_id!, onProgress)).output_photo_id;
}

/** Gives the clip exactly these looks (in their order), made one after another; progress 0..100 over them all. */
export async function restyle(store: EditorStore, clipId: string, looks: Look[], onProgress: (value: number) => void): Promise<void> {
  const clip = findClip(store.timeline!, clipId);
  if (!clip) return;
  const part = originalPart(clip);
  const made = await makeLooks(part, looks, (look, source, step) => makeLook(look, source, part, (value) => onProgress(((step + value / 100) / looks.length) * 100)));
  if (made) store.addMedia(await getPhoto(made.media));
  store.change(setLooks(store.timeline!, clipId, part, looks, made));
}

const OPEN = 'kanaa:remove-look';
/** Takes one look off a clip from the menu: the others are rebuilt without it. */
export function removeLook(clipId: string, kind: LookKind) { window.dispatchEvent(new CustomEvent(OPEN, { detail: { clipId, kind } })); }

export function LooksHost() {
  const store = useContext(EditorContext);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const run = (event: Event) => {
      const { clipId, kind } = (event as CustomEvent<{ clipId: string; kind: LookKind }>).detail;
      const clip = store?.timeline && findClip(store.timeline, clipId);
      if (!store || !clip) return;
      setError(null); setBusy(0);
      restyle(store, clipId, withoutLook(looksOf(clip), kind), setBusy).catch((problem) => setError((problem as Error).message)).finally(() => setBusy(null));
    };
    window.addEventListener(OPEN, run);
    return () => window.removeEventListener(OPEN, run);
  }, [store]);
  if (busy === null && !error) return null;
  return createPortal(<div className="ed-looks-status" role="status">
    {busy !== null ? <><LoaderCircle className="spin" size={13}/> {t('Updating the looks…')} {busy ? `${Math.round(busy)}%` : ''}</> : <span className="ed-error">{error}</span>}
    {error && <button className="ed-button" onClick={() => setError(null)}>{t('Close')}</button>}
  </div>, document.querySelector('.ed') ?? document.body);
}
