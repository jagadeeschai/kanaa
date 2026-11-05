/**
 * Cut to the beat: each clip on the main track ends on the music's beat nearest to where it ends now.
 * Uses the same beat finder as lyric videos (backend beat_service.py), on the song already in the video.
 */
import { audioLayers, mainLayer, type Clip, type Sound, type SourceFacts, type Timeline } from './model.ts';

/** Shorter than this and a cut feels like a flash. */
export const MIN_BEAT_CLIP = 0.5;
const PHOTO_LIMIT = 600;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The song the cuts follow: the longest song (not a clip's own sound) on an audible audio track. */
export function beatSound(timeline: Timeline): (Sound & { asset_id: string }) | null {
  const sounds = audioLayers(timeline).filter((layer) => !layer.muted).flatMap((layer) => layer.items).filter((sound) => !sound.muted && Boolean(sound.asset_id));
  return (sounds.sort((a, b) => (b.out - b.in) / b.speed - (a.out - a.in) / a.speed)[0] as (Sound & { asset_id: string }) | undefined) ?? null;
}

/** Beats in the song's own seconds, placed on the timeline where that sound plays them. */
export function timelineBeats(sound: Sound, beats: number[]): number[] {
  return beats.filter((beat) => beat >= sound.in && beat <= sound.out).map((beat) => round(sound.start + (beat - sound.in) / sound.speed));
}

/**
 * Moves each clip's end to the nearest beat. Clips may grow (up to the end of their source) or shrink,
 * but never below MIN_BEAT_CLIP. Clips past the last beat stay as they are. Returns the new timeline and how many clips changed.
 */
export function cutToBeats(timeline: Timeline, beats: number[], source: (mediaId: number) => SourceFacts | undefined): { timeline: Timeline; changed: number } {
  const sorted = [...beats].sort((a, b) => a - b);
  const main = mainLayer(timeline);
  if (main.locked || !sorted.length) return { timeline, changed: 0 };
  let cursor = 0; let changed = 0;
  const clips = [...main.items].sort((a, b) => a.start - b.start).map((clip): Clip => {
    const length = (clip.out - clip.in) / clip.speed;
    const facts = source(clip.media_id);
    const longest = facts?.media_type === 'image' || clip.freeze != null ? PHOTO_LIMIT
      : clip.reverse ? clip.out / clip.speed : ((facts?.duration ?? clip.out) - clip.in) / clip.speed;
    const target = cursor + length;
    let best: number | null = null;
    for (const beat of sorted) {
      const span = beat - cursor;
      if (span < MIN_BEAT_CLIP - 1e-6 || span > longest + 1e-6) continue;
      if (best === null || Math.abs(beat - target) < Math.abs(best - target)) best = beat;
    }
    if (best === null) { cursor += length; return { ...clip, start: round(cursor - length) }; }
    const next = best - cursor;
    const start = round(cursor);
    cursor = best;
    if (Math.abs(next - length) < 1e-3) return { ...clip, start };
    changed += 1;
    // A reversed clip shows its source's end first, so it keeps that end and moves its start.
    return clip.reverse ? { ...clip, start, in: round(Math.max(0, clip.out - next * clip.speed)) } : { ...clip, start, out: round(clip.in + next * clip.speed) };
  });
  return { timeline: { ...timeline, layers: timeline.layers.map((layer) => (layer === main ? { ...main, items: clips } : layer)) }, changed };
}
