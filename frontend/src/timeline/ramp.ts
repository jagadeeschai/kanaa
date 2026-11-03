import type { Clip } from './model';

/**
 * A speed ramp: relative speed at points through the clip's time, `t` from 0 to 1, straight lines between.
 * It is scaled so its average is 1, so the clip keeps its length and overall speed. Matches ramp_* in timeline_service.py.
 */
export type RampPoint = { t: number; v: number };
export type RampName = 'hero' | 'bullet' | 'montage' | 'speed-up' | 'slow-down';
const points = (...pairs: [number, number][]): RampPoint[] => pairs.map(([t, v]) => ({ t, v }));
export const RAMPS: Record<RampName, RampPoint[]> = {
  hero: points([0, 1.6], [0.35, 1.6], [0.45, 0.3], [0.6, 0.3], [0.7, 1.6], [1, 1.6]),
  bullet: points([0, 2.5], [0.38, 2.5], [0.45, 0.15], [0.75, 0.15], [0.82, 2.5], [1, 2.5]),
  montage: points([0, 1], [0.15, 3], [0.3, 0.5], [0.5, 0.5], [0.65, 3], [0.85, 1], [1, 1]),
  'speed-up': points([0, 0.3], [0.5, 1], [1, 2.2]),
  'slow-down': points([0, 2.2], [0.5, 1], [1, 0.3]),
};
export const MIN_RAMP = 0.05; export const MAX_RAMP = 10;

type Segment = { t0: number; t1: number; r0: number; r1: number; x0: number; x1: number };

/** Each straight piece, with the speeds scaled to average 1 and the share of the source played before it. */
function segments(ramp: RampPoint[]): Segment[] {
  const mean = ramp.slice(1).reduce((sum, point, index) => sum + ((point.t - ramp[index].t) * (point.v + ramp[index].v)) / 2, 0);
  let x = 0;
  return ramp.slice(1).map((point, index) => {
    const a = ramp[index];
    const r0 = a.v / mean; const r1 = point.v / mean;
    const segment = { t0: a.t, t1: point.t, r0, r1, x0: x, x1: x + ((point.t - a.t) * (r0 + r1)) / 2 };
    x = segment.x1;
    return segment;
  });
}

/** The share of the source played after `u` of the clip's time. Outside 0..1 the end speeds carry on, for transitions. */
export function rampShare(ramp: RampPoint[], u: number): number {
  const parts = segments(ramp);
  if (u <= 0) return u * parts[0].r0;
  const last = parts[parts.length - 1];
  if (u >= 1) return 1 + (u - 1) * last.r1;
  const part = parts.find((item) => u <= item.t1) ?? last;
  const d = u - part.t0;
  return part.x0 + part.r0 * d + ((part.r1 - part.r0) / (part.t1 - part.t0)) * d * d / 2;
}

/** The inverse: how far through the clip's time a share of the source plays. */
export function rampTime(ramp: RampPoint[], x: number): number {
  const parts = segments(ramp);
  if (x <= 0) return x / parts[0].r0;
  const last = parts[parts.length - 1];
  if (x >= 1) return 1 + (x - 1) / last.r1;
  const part = parts.find((item) => x <= item.x1) ?? last;
  const k = (part.r1 - part.r0) / (part.t1 - part.t0);
  const into = x - part.x0;
  return part.t0 + (Math.abs(k) < 1e-9 ? into / part.r0 : (-part.r0 + Math.sqrt(Math.max(0, part.r0 * part.r0 + 2 * k * into))) / k);
}

/** Relative speed at `u`, for drawing the curve. */
export function rampSpeed(ramp: RampPoint[], u: number): number {
  const parts = segments(ramp);
  const part = parts.find((item) => u <= item.t1) ?? parts[parts.length - 1];
  return part.r0 + ((part.r1 - part.r0) * (Math.min(Math.max(u, part.t0), part.t1) - part.t0)) / (part.t1 - part.t0);
}

const length = (clip: Clip) => (clip.out - clip.in) / clip.speed;

/** Source seconds shown `local` seconds into a clip, for a ramp, a reversed clip, or neither. */
export function sourceAt(clip: Clip, local: number): number {
  const span = clip.out - clip.in;
  const into = clip.ramp ? rampShare(clip.ramp, local / length(clip)) * span : local * clip.speed;
  return clip.reverse ? clip.out - into : clip.in + into;
}

/** The clip's own seconds at which a source moment is shown. */
export function localAt(clip: Clip, seconds: number): number {
  const span = clip.out - clip.in;
  const into = clip.reverse ? clip.out - seconds : seconds - clip.in;
  return clip.ramp ? rampTime(clip.ramp, into / span) * length(clip) : into / clip.speed;
}

/** The two halves of a ramp cut `u` of the way through, each over its own 0..1. */
export function splitRamp(ramp: RampPoint[], u: number): [RampPoint[], RampPoint[]] {
  const at = { t: u, v: interpolate(ramp, u) };
  const before = [...ramp.filter((point) => point.t < u - 1e-6), at].map((point) => ({ t: point.t / u, v: point.v }));
  const after = [at, ...ramp.filter((point) => point.t > u + 1e-6)].map((point) => ({ t: (point.t - u) / (1 - u), v: point.v }));
  return [before, after];
}

function interpolate(ramp: RampPoint[], u: number): number {
  const index = ramp.findIndex((point) => point.t >= u);
  if (index <= 0) return ramp[Math.max(0, index)].v;
  const a = ramp[index - 1]; const b = ramp[index];
  return a.v + ((b.v - a.v) * (u - a.t)) / (b.t - a.t);
}
