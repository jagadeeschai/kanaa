/** Sit on the skyline: the title's place over time so the bottom of its letters rests on the horizon (a little below
 *  it, so the land just covers their base), following the horizon found at each moment. */
import type { Keyframe, Transform } from './evaluate.ts';

export const SINK = 0.1;  // Of the letters' height: how far their base dips behind the land.

/** `box`: the letters at rest (x0, y0, x1, y1 shares of the frame); `skyline[k]`: the horizon at `moments[k]` seconds
 *  into the title, or null where none was found. Null when there is no horizon at all. */
export function onTheSkyline(transform: Transform | undefined, box: [number, number, number, number], moments: number[], skyline: (number | null)[]): Transform | null {
  const base: Transform = transform ?? { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
  const scale = base.scale ?? 1;
  const height = (box[3] - box[1]) * scale;
  const yFor = (horizon: number) => Math.round((horizon + SINK * height - (box[3] - 0.5) * scale) * 10000) / 10000;
  const keys: Keyframe[] = moments.flatMap((t, k) => (skyline[k] === null || skyline[k] === undefined ? [] : [{ t: Math.round(t * 1000) / 1000, v: yFor(skyline[k]!), ease: 'linear' as const }]));
  if (!keys.length) return null;
  const { y: _old, ...others } = base.keyframes ?? {};
  return keys.length === 1 ? { ...base, y: keys[0].v, keyframes: others } : { ...base, y: keys[0].v, keyframes: { ...others, y: keys } };
}
