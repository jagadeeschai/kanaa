/**
 * Edits that keep a song video in sync: the length of the main track never changes, so nothing timed to the song
 * (lyrics, the song itself, beats) can drift.
 * - replaceClips: one picture or video takes exactly the place of one or more neighbouring clips.
 * - deleteAndStretch: a clip goes and its neighbour grows to fill its time.
 * Both change only the main track; other layers are left exactly where they are.
 */
import { shiftKeys } from './keyframes.ts';
import { clipLength, mainLayer, MAX_PHOTO_SECONDS, MIN_CLIP_SECONDS, newClip, type Clip, type SourceFacts, type Timeline } from './model.ts';

const round = (value: number) => Math.round(value * 1000) / 1000;
export const MIN_SPEED = 0.25;

/** Layers that follow the song, not the pictures: they stay put when main clips are added, removed or trimmed. */
export const SONG_LAYER_IDS = new Set(['song', 'lyric-titles', 'lyrics-answer']);
export const isSongVideo = (timeline: Timeline) => timeline.layers.some((layer) => layer.kind === 'audio' && layer.id === 'song' && layer.items.length > 0);

function withMain(timeline: Timeline, items: Clip[]): Timeline {
  const main = mainLayer(timeline);
  let cursor = 0;
  const packed = items.map((clip) => { const placed = { ...clip, start: round(cursor) }; cursor += clipLength(clip); return placed; });
  return { ...timeline, layers: timeline.layers.map((layer) => (layer === main ? { ...main, items: packed } : layer)) };
}

export type ReplaceResult = { timeline: Timeline } | { problem: string };

/**
 * The new picture or video in place of the selected main clips (they must be next to each other). A picture fills
 * their time; a video is trimmed to it, or slowed (never below a quarter speed) when shorter. The first clip's
 * transition in is kept.
 */
export function replaceClips(timeline: Timeline, ids: string[], source: SourceFacts, id: string): ReplaceResult {
  const items = mainLayer(timeline).items;
  const picked = items.map((clip, index) => (ids.includes(clip.id) ? index : -1)).filter((index) => index >= 0);
  if (!picked.length) return { problem: 'Select the clips on the main track to replace first.' };
  if (picked.some((index, k) => k > 0 && index !== picked[k - 1] + 1)) return { problem: 'Select clips that are next to each other.' };
  const first = items[picked[0]];
  const span = round(picked.reduce((sum, index) => sum + clipLength(items[index]), 0));
  const base = newClip(source, id);
  let placed: Clip;
  if (source.media_type === 'image') {
    if (span > MAX_PHOTO_SECONDS) return { problem: 'That is longer than a picture can be shown.' };
    placed = { ...base, out: span };
  } else {
    const duration = source.duration ?? 0;
    if (duration >= span) placed = { ...base, out: round(span) };
    else {
      const speed = duration / span;
      if (speed < MIN_SPEED) return { problem: `This video is ${duration.toFixed(1)} s; it can fill at most ${(duration / MIN_SPEED).toFixed(1)} s, and the clips take ${span.toFixed(1)} s.` };
      placed = { ...base, out: round(duration), speed: round(speed * 10000) / 10000 };
    }
  }
  placed = { ...placed, transition_in: first.transition_in ?? null };
  const next = [...items.slice(0, picked[0]), placed, ...items.slice(picked[picked.length - 1] + 1)];
  return { timeline: withMain(timeline, next) };
}

/** How much longer a clip can play from its source at its end (or its start). Pictures and frozen frames: any. */
function room(clip: Clip, source: SourceFacts | undefined, end: 'end' | 'start'): number {
  if (clip.ramp) return 0;
  if (source?.media_type === 'image' || clip.freeze != null) return MAX_PHOTO_SECONDS - clipLength(clip);
  const duration = source?.duration ?? clip.out;
  const atEnd = (end === 'end') !== Boolean(clip.reverse);
  return (atEnd ? duration - clip.out : clip.in) / clip.speed;
}

/**
 * Deletes a main clip and lets the clip before it grow to fill its time (or the clip after, when there is no room
 * before). Null when neither can: then the caller deletes as usual or says so.
 */
export function deleteAndStretch(timeline: Timeline, id: string, sources: (mediaId: number) => SourceFacts | undefined): Timeline | null {
  const items = mainLayer(timeline).items;
  const index = items.findIndex((clip) => clip.id === id);
  if (index < 0) return null;
  const gap = clipLength(items[index]);
  const before = items[index - 1]; const after = items[index + 1];
  const grow = (clip: Clip, end: 'end' | 'start'): Clip => {
    const by = gap * clip.speed;
    const atEnd = (end === 'end') !== Boolean(clip.reverse);
    const changed = atEnd ? { ...clip, out: round(clip.out + by) } : { ...clip, in: round(clip.in - by) };
    // Growing at the start: its moves keep their place in the picture.
    return end === 'start' ? { ...changed, transform: shiftKeys(clip.transform, gap) } : changed;
  };
  if (before && room(before, sources(before.media_id), 'end') >= gap - 1e-6)
    return withMain(timeline, items.flatMap((clip, k) => (k === index ? [] : k === index - 1 ? [grow(clip, 'end')] : [clip])));
  if (after && room(after, sources(after.media_id), 'start') >= gap - 1e-6)
    return withMain(timeline, items.flatMap((clip, k) => (k === index ? [] : k === index + 1 ? [{ ...grow(clip, 'start'), transition_in: items[index].transition_in ?? clip.transition_in ?? null }] : [clip])));
  return null;
}

/** Source facts from the media list (what deleteAndStretch needs to know of each clip's file). */
export const factsFrom = (media: ReadonlyMap<number, { media_type: string; duration?: number | null }>) => (mediaId: number): SourceFacts | undefined => {
  const item = media.get(mediaId);
  return item && { media_id: mediaId, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration ?? null };
};

export { MIN_CLIP_SECONDS };
