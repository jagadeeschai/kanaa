export type Ease = 'linear' | 'easeOut' | 'easeInOut' | 'bounce' | 'snap';
export type Keyframe = { t: number; v: number; ease?: Ease };
export type AnimatedProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'tilt_x' | 'tilt_y';
export type Transform = { x: number; y: number; scale: number; opacity: number; rotation?: number; tilt_x?: number; tilt_y?: number; keyframes?: Partial<Record<AnimatedProperty, Keyframe[]>> };

const EASE: Record<Ease, (p: number) => number> = {
  linear: (p) => p,
  easeOut: (p) => 1 - (1 - p) ** 3,
  easeInOut: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - ((-2 * p + 2) ** 3) / 2),
  /** Goes a little past, then settles back. */
  bounce: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
  /** Darts most of the way at once, then eases in. */
  snap: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
};

/** The value of a property `t` seconds into an item. Matches value_at in timeline_schema.py. */
export function valueAt(transform: Transform, property: AnimatedProperty, t: number): number {
  const keys = transform.keyframes?.[property];
  if (!keys?.length) return transform[property] ?? 0;
  if (t <= keys[0].t) return keys[0].v;
  for (let index = 0; index + 1 < keys.length; index += 1) {
    const a = keys[index];
    const b = keys[index + 1];
    if (t < b.t) return a.v + (b.v - a.v) * EASE[a.ease ?? 'linear']((t - a.t) / (b.t - a.t));
  }
  return keys[keys.length - 1].v;
}
