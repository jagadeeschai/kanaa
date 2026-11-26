/**
 * Film stocks: one-click bundles of the camera and film looks (the Cinematic tab's top row). Choosing one sets these
 * kinds of look (STOCK_KINDS) to the bundle and leaves the scene's own looks (colour match, sky, night, rays, air, slow
 * motion) as they are; None takes the bundle's kinds off again. Each look stays editable in its card afterwards.
 */
import { LOOK_ORDER, type Look, type LookKind } from './stack.ts';

/** The kinds a film stock sets (and None clears). */
export const STOCK_KINDS: readonly LookKind[] = ['lens', 'halation', 'shake', 'weave', 'breathing', 'blur'];

export const FILM_STOCKS: readonly { id: string; label: string; about: string; looks: Look[] }[] = [
  { id: 'classic', label: 'Classic film', about: 'Warm highlight glow and a gentle 35mm gate weave',
    looks: [{ kind: 'halation', preset: 'classic' }, { kind: 'weave', preset: 'subtle' }] },
  { id: 'retro', label: '70s Tamil cinema', about: 'A strong warm glow, a worn projector drift and a breathing lens',
    looks: [{ kind: 'halation', preset: 'dreamy' }, { kind: 'weave', preset: 'worn' }, { kind: 'breathing', preset: 'subtle' }] },
  { id: 'docu', label: 'Documentary', about: 'Shoulder-held camera with natural motion blur',
    looks: [{ kind: 'shake', preset: 'docu' }, { kind: 'breathing', preset: 'subtle' }, { kind: 'blur', preset: 'natural' }] },
  { id: 'dream', label: 'Dreamy', about: 'Soft background, glowing highlights and a slow float',
    looks: [{ kind: 'lens', preset: 'dreamy', strength: 'medium' }, { kind: 'halation', preset: 'dreamy' }, { kind: 'shake', preset: 'float' }] },
  { id: 'action', label: 'Action', about: 'A jolt that settles and heavy motion blur, for hits and drops',
    looks: [{ kind: 'shake', preset: 'impact' }, { kind: 'blur', preset: 'action' }] },
];

const byOrder = (a: Look, b: Look) => LOOK_ORDER.indexOf(a.kind) - LOOK_ORDER.indexOf(b.kind);

/** `looks` with film stock `id` (null: None): its kinds replaced by the stock's, the rest kept. */
export function withStock(looks: Look[], id: string | null): Look[] {
  const kept = looks.filter((look) => !STOCK_KINDS.includes(look.kind));
  const stock = FILM_STOCKS.find((each) => each.id === id);
  return [...kept, ...(stock?.looks ?? [])].sort(byOrder);
}

/** Which film stock `looks` are exactly (untuned), if any: '' when none of its kinds are on. */
export function stockOf(looks: Look[]): string | null {
  const ours = looks.filter((look) => STOCK_KINDS.includes(look.kind));
  if (!ours.length) return '';
  const key = (list: Look[]) => JSON.stringify([...list].sort(byOrder));
  return FILM_STOCKS.find((stock) => key(stock.looks) === key(ours))?.id ?? null;
}
