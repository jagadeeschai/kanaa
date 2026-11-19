/** Draw its path: a stroke dragged across the preview becomes the route of a clip or title. The stroke is evened out
 * into points along its length, timed so it starts and stops gently (Smooth) or keeps one pace (Steady). */
import type { Keyframe, Transform } from './evaluate.ts';

export type PathFeel = 'smooth' | 'steady';
const POINTS = 16;

const smooth = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - ((-2 * p + 2) ** 3) / 2);

/** The time share at which the smooth curve has covered `share` of the way. */
function smoothTime(share: number): number {
  let low = 0, high = 1;
  for (let step = 0; step < 30; step += 1) { const mid = (low + high) / 2; if (smooth(mid) < share) low = mid; else high = mid; }
  return (low + high) / 2;
}

/** `stroke` in shares of the frame. Null when it is too short to be a path (a click). */
export function pathFromStroke(transform: Transform, stroke: [number, number][], from: number, to: number, feel: PathFeel = 'smooth'): Transform | null {
  const points = stroke.filter((point, index) => index === 0 || Math.hypot(point[0] - stroke[index - 1][0], point[1] - stroke[index - 1][1]) > 1e-4);
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) lengths.push(lengths[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
  const total = lengths[lengths.length - 1];
  if (points.length < 2 || total < 0.03 || to - from < 0.2) return null;
  const at = (distance: number): [number, number] => {
    let index = 1;
    while (index < lengths.length - 1 && lengths[index] < distance) index += 1;
    const span = lengths[index] - lengths[index - 1] || 1;
    const p = Math.min(1, Math.max(0, (distance - lengths[index - 1]) / span));
    return [points[index - 1][0] + (points[index][0] - points[index - 1][0]) * p, points[index - 1][1] + (points[index][1] - points[index - 1][1]) * p];
  };
  const round = (value: number) => Math.round(value * 10000) / 10000;
  const xs: Keyframe[] = [], ys: Keyframe[] = [];
  for (let index = 0; index < POINTS; index += 1) {
    const share = index / (POINTS - 1);
    const [x, y] = at(share * total);
    const t = round(from + (to - from) * (feel === 'smooth' ? smoothTime(share) : share));
    xs.push({ t, v: round(x), ease: 'linear' }); ys.push({ t, v: round(y), ease: 'linear' });
  }
  const [x, y] = [xs[0].v, ys[0].v];
  return { ...transform, x, y, keyframes: { ...(transform.keyframes ?? {}), x: xs, y: ys } };
}
