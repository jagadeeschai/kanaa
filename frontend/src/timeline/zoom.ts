/** Zooming a picture or video by hand: its size at the playhead, kept within sensible bounds, and keyframes respected. */
import { valueAt, type Transform } from './evaluate.ts';
import { writeValue } from './keyframes.ts';

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 4;

/** `transform` with its size at `local` multiplied by `factor` (a pinch, a scroll step), within bounds. */
export function zoomBy(transform: Transform, local: number, factor: number): Transform {
  const now = valueAt(transform, 'scale', local);
  return writeValue(transform, 'scale', local, Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, now * factor)) * 1000) / 1000);
}

/** A wheel or trackpad pinch step as a zoom factor: pinches arrive with ctrl held, gentle scrolls with ⌘. */
export function wheelFactor(deltaY: number, pinch: boolean): number {
  return Math.exp(-deltaY * (pinch ? 0.01 : 0.002));
}
