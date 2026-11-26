/**
 * Beat-synced moments: looks that follow the song's real beats (the same beat finder as Cut to the beat, timeline/beats.ts).
 * - Handheld shake "On the beat": a jolt on each beat inside the clip (hitsFor gives them, as seconds into its part).
 * - Beat pulse "Match the song": the pulse's tempo and first beat taken from the song (pulseFor).
 */
import { originalPart } from './stack.ts';
import type { BeatPulse, Clip } from './model.ts';

const round = (value: number) => Math.round(value * 1000) / 1000;
const length = (clip: Clip) => (clip.out - clip.in) / clip.speed;

/** The beats (timeline seconds) that fall inside the clip, as seconds into the part its looks are made from. */
export function hitsFor(clip: Clip, beats: number[]): number[] {
  const part = originalPart(clip);
  const made = part.media !== clip.media_id;  // Playing a made copy: its time runs 1:1 with the part, but slow motion stretches it.
  const slower = clip.slowmo?.factor ?? 1;
  return beats.filter((beat) => beat >= clip.start && beat < clip.start + length(clip)).map((beat) => {
    const local = (beat - clip.start) * clip.speed;
    return round(made ? (clip.in + local) / slower : clip.in - part.start + local);
  }).filter((hit) => hit >= 0 && hit <= part.end - part.start);
}

/** A beat pulse on the song's tempo, its first beat on the clip's first beat. Null without enough beats on the clip. */
export function pulseFor(clip: Clip, beats: number[], base: BeatPulse): BeatPulse | null {
  const sorted = [...beats].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((beat, n) => beat - sorted[n]).filter((gap) => gap > 0.15 && gap < 2).sort((a, b) => a - b);
  if (!gaps.length) return null;
  const interval = gaps[Math.floor(gaps.length / 2)];  // The middle gap: the song's beat, whatever a missed or extra beat does.
  const first = sorted.find((beat) => beat >= clip.start - 1e-6 && beat < clip.start + length(clip));
  if (first === undefined) return null;
  return { ...base, bpm: Math.max(30, Math.min(300, round(60 / interval))), offset: round((first - clip.start) % interval) };
}
