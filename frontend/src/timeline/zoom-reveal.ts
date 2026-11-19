/** Zoom through the letters: over the end of a video-inside-text title it flies into one letter (`hole`, shares of the
 * frame) until the scene fills the frame, then the card fades. The letter stays where it is on screen while it grows. */
import { valueAt, type Keyframe, type Transform } from './evaluate.ts';
import type { TextItem } from './model.ts';

export const REVEAL_SECONDS = 1.4;
export const REVEAL_SCALE = 45;
const FADE = 0.2;

const round = (value: number) => Math.round(value * 100000) / 100000;

export function hasZoomReveal(text: TextItem): boolean {
  return (text.transform?.keyframes?.scale ?? []).some((key) => key.v >= REVEAL_SCALE - 1e-6);
}

export function zoomReveal(text: TextItem, hole: { x: number; y: number }): TextItem {
  const transform: Transform = text.transform ?? { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
  const end = text.length, from = Math.max(0, end - REVEAL_SECONDS);
  const s0 = valueAt(transform, 'scale', from), x0 = valueAt(transform, 'x', from), y0 = valueAt(transform, 'y', from);
  // Where the letter is on screen now; the title's middle moves so it stays there as the size grows.
  const sx = x0 + (hole.x - 0.5) * s0, sy = y0 + (hole.y - 0.5) * s0;
  const before = (property: 'x' | 'y' | 'scale' | 'opacity', rest: number): Keyframe[] => {
    const keys = (transform.keyframes?.[property] ?? []).filter((key) => key.t < from - 1e-6);
    return keys.length ? keys : (property === 'opacity' ? [] : [{ t: 0, v: rest, ease: 'linear' }]);
  };
  const flight = (property: 'x' | 'y' | 'scale', start: number, finish: number): Keyframe[] => [...before(property, start).map((key) => ({ ...key })), { t: round(from), v: round(start), ease: 'easeInOut' }, { t: round(end), v: round(finish) }];
  const keyframes = { ...(transform.keyframes ?? {}),
    scale: flight('scale', s0, REVEAL_SCALE),
    x: flight('x', x0, sx - (hole.x - 0.5) * REVEAL_SCALE),
    y: flight('y', y0, sy - (hole.y - 0.5) * REVEAL_SCALE),
    opacity: [{ t: 0, v: 1, ease: 'linear' as const }, { t: round(end - FADE), v: 1, ease: 'linear' as const }, { t: round(end), v: 0 }] };
  // The flight is the ending: no exit animation on top of it.
  return { ...text, exit: null, transform: { ...transform, keyframes } };
}
