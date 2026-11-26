/**
 * Velocity edit: a speed ramp built from the song's beats, so the clip races between beats and slows into each hit
 * (the reels look). It is an ordinary speed ramp (timeline/ramp.ts), scaled to average 1, so the clip keeps its length
 * and the cut stays on the beat; Off in Speed ramp takes it away.
 */
import { MAX_RAMP, MIN_RAMP, type RampPoint } from './ramp.ts';
import { mainLayer, type Clip, type Timeline } from './model.ts';

export type VelocityName = 'smooth' | 'punchy' | 'dramatic';
/** slow: speed at a hit; fast: between hits; hold: how much of the gap either side of a hit stays slow. */
export const VELOCITY: Record<VelocityName, { slow: number; fast: number; hold: number }> = {
  smooth: { slow: 0.5, fast: 1.6, hold: 0.3 },
  punchy: { slow: 0.25, fast: 2.6, hold: 0.18 },
  dramatic: { slow: 0.15, fast: 3.2, hold: 0.32 },
};
export const VELOCITY_CHOICES: { id: VelocityName; label: string; about: string }[] = [
  { id: 'smooth', label: 'Smooth', about: 'A gentle rush between beats, easing into each one' },
  { id: 'punchy', label: 'Punchy', about: 'Fast between beats, a sharp slow on each hit' },
  { id: 'dramatic', label: 'Dramatic', about: 'Racing between beats, a long slow hold on each hit' },
];
/** The most points a ramp may have (timeline_schema.py), and the shortest gap between beats worth ramping. */
const MOST_POINTS = 20; const SHORTEST_GAP = 0.25;
const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number) => Math.min(MAX_RAMP, Math.max(MIN_RAMP, value));

/** The velocity ramp for a clip from the beats (timeline seconds), or null when fewer than two beats fall in it. */
export function velocityRamp(clip: Clip, beats: number[], name: VelocityName): RampPoint[] | null {
  const length = (clip.out - clip.in) / clip.speed;
  let hits = [...beats].sort((a, b) => a - b).filter((beat) => beat > clip.start && beat < clip.start + length).map((beat) => (beat - clip.start) / length);
  if (hits.length < 2 || (hits[1] - hits[0]) * length < SHORTEST_GAP) return null;
  // Too many beats for the ramp's points (three each, and the two ends): every other beat, and so on.
  while (hits.length * 3 + 2 > MOST_POINTS) hits = hits.filter((_, n) => n % 2 === 0);
  const { slow, fast, hold } = VELOCITY[name];
  const gap = hits.length > 1 ? Math.min(...hits.slice(1).map((hit, n) => hit - hits[n])) : 1;
  const half = (gap * hold) / 2;
  const points: RampPoint[] = [{ t: 0, v: fast }];
  for (const [n, hit] of hits.entries()) {
    // Slow either side of the hit, and full speed halfway to the next.
    const next = hits[n + 1];
    for (const [t, v] of [[hit - half, slow], [hit + half, slow], ...(next === undefined ? [] : [[(hit + next) / 2, fast]])] as [number, number][]) {
      if (t > points[points.length - 1].t + 1e-3 && t < 1 - 1e-3) points.push({ t: round(t), v: clamp(v) });
    }
  }
  points.push({ t: 1, v: fast });
  return points.map((point) => ({ t: point.t, v: clamp(point.v) }));
}

/** Clips a velocity edit can go on: video clips playing normally (not reversed, frozen or in 3D freeze). */
export const canVelocity = (clip: Clip) => !clip.reverse && clip.freeze == null && !clip.freeze3d;

/** Every main-track clip with the velocity ramp (the ones with too few beats left as they are). */
export function velocityEvery(timeline: Timeline, beats: number[], name: VelocityName): { id: string; ramp: RampPoint[] }[] {
  return mainLayer(timeline).items.flatMap((clip) => {
    const ramp = canVelocity(clip) ? velocityRamp(clip, beats, name) : null;
    return ramp && JSON.stringify(ramp) !== JSON.stringify(clip.ramp) ? [{ id: clip.id, ramp }] : [];
  });
}
