// The value of an animated property at time t. spike/compile.py produces the same math as ffmpeg expressions.
export const EASE = {
  linear: (p) => p,
  easeOut: (p) => 1 - (1 - p) ** 3,
  easeInOut: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - ((-2 * p + 2) ** 3) / 2),
};
export function valueAt(transform, property, t) {
  const keys = transform.keyframes?.[property];
  if (!keys?.length) return transform[property];
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i + 1 < keys.length; i += 1) {
    const a = keys[i]; const b = keys[i + 1];
    if (t < b.t) return a.v + (b.v - a.v) * EASE[a.ease ?? 'linear']((t - a.t) / (b.t - a.t));
  }
  return keys[keys.length - 1].v;
}
