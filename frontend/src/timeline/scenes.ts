/** Splitting a long recording at its scene changes (found by backend scene_service.py). */
import { clipLength, mainLayer, MIN_CLIP_SECONDS, splitClip, type Timeline } from './model.ts';

/** Cuts are source seconds. Each one inside the clip becomes a split, in one change. Returns how many splits were made. */
export function splitAtCuts(timeline: Timeline, clipId: string, cuts: number[], newId: () => string): { timeline: Timeline; splits: number } {
  const clip = mainLayer(timeline).items.find((item) => item.id === clipId);
  if (!clip || mainLayer(timeline).locked) return { timeline, splits: 0 };
  // A reversed clip plays its source backwards, so a later source second comes earlier on the timeline.
  const times = cuts.filter((cut) => cut > clip.in && cut < clip.out)
    .map((cut) => clip.start + (clip.reverse ? clip.out - cut : cut - clip.in) / clip.speed)
    .filter((t) => t > clip.start + MIN_CLIP_SECONDS && t < clip.start + clipLength(clip) - MIN_CLIP_SECONDS)
    .sort((a, b) => b - a); // Latest first, so earlier times stay where they are.
  let next = timeline; let splits = 0;
  for (const t of times) {
    const after = splitClip(next, t, newId());
    if (after !== next) { next = after; splits += 1; }
  }
  return { timeline: next, splits };
}
