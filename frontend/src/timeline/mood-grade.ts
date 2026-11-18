/**
 * Mood grade: each part of a song in its own colour, one click. The verses calm, the chorus richer, found from the
 * lyrics (song-sections.ts). Each part is a span of one adjustment layer, under the lyrics so the words keep their
 * colour, fading into the next; the GPU engine grades it like the export (adjust_layer.py).
 */
import type { LookName } from './animation.ts';
import { DEFAULT_ADJUST, type AdjustItem, type AdjustLayer, type Timeline, duration } from './model.ts';
import { chorusLines, lyricLines, sectionStarts } from './song-sections.ts';

export type Mood = 'warm-rich' | 'cool-to-warm' | 'film';
export const MOODS: { id: Mood; label: string; tip: string }[] = [
  { id: 'warm-rich', label: 'Warm and rich', tip: 'Soft warm verses; a vivid, deeper chorus' },
  { id: 'cool-to-warm', label: 'Cool to warm', tip: 'Cool, quiet verses; the chorus bursts warm' },
  { id: 'film', label: 'Film', tip: 'Faded film verses; a vivid chorus' },
];
export const MOOD_LAYER = 'mood-grade';
const FADE = 0.6;

type Grade = { look: LookName; saturation: number; contrast: number };
const GRADES: Record<Mood, { verse: Grade; chorus: Grade }> = {
  'warm-rich': { verse: { look: 'warm', saturation: 0.92, contrast: 1 }, chorus: { look: 'vivid', saturation: 1.08, contrast: 1.06 } },
  'cool-to-warm': { verse: { look: 'cool', saturation: 0.9, contrast: 1 }, chorus: { look: 'warm', saturation: 1.1, contrast: 1.05 } },
  'film': { verse: { look: 'film', saturation: 0.9, contrast: 1 }, chorus: { look: 'vivid', saturation: 1.05, contrast: 1.05 } },
};

/** The song's parts as [start, end, chorus?]: each runs until the next begins (the last, to the end of the video). */
export function songParts(timeline: Timeline): [number, number, boolean][] {
  const starts = sectionStarts(timeline);
  const chorus = new Set(chorusLines(timeline).map((line) => line.id));
  const lines = lyricLines(timeline);
  const end = duration(timeline);
  return starts.map((start, index) => {
    const first = lines.find((line) => Math.abs(line.start - start) < 1e-6);
    return [start, starts[index + 1] ?? end, Boolean(first && chorus.has(first.id))] as [number, number, boolean];
  }).filter(([start, stop]) => stop - start > 0.1);
}

/** The mood grade taken away. */
export function clearMood(timeline: Timeline): Timeline {
  return { ...timeline, layers: timeline.layers.filter((layer) => !layer.id.startsWith(MOOD_LAYER)) };
}

/** Each part of the song graded for `mood`, under the lyrics. Choosing again replaces the last mood. */
export function applyMood(timeline: Timeline, mood: Mood): Timeline {
  const cleared = clearMood(timeline);
  const parts = songParts(cleared);
  if (!parts.length) return cleared;
  const items: AdjustItem[] = parts.map(([start, end, chorus], index) => {
    const grade = GRADES[mood][chorus ? 'chorus' : 'verse'];
    // Neighbouring parts overlap by a fade, so one grade melts into the next instead of cutting.
    const from = Math.max(0, start - (index ? FADE / 2 : 0)), to = Math.min(duration(cleared), end + (index < parts.length - 1 ? FADE / 2 : 0));
    return { id: `mood-${index}`, name: chorus ? 'Chorus' : 'Verse', start: Math.round(from * 1000) / 1000, length: Math.round((to - from) * 1000) / 1000, look: grade.look,
      adjust: { ...DEFAULT_ADJUST, saturation: grade.saturation, contrast: grade.contrast }, fade_in: index ? FADE : 0, fade_out: index < parts.length - 1 ? FADE : 0 };
  });
  // Spans of one layer may not overlap: alternate parts go on a second span list, both in one layer each.
  const even: AdjustLayer = { id: MOOD_LAYER, kind: 'adjust', name: 'Mood', ripple: false, items: items.filter((_, index) => index % 2 === 0) };
  const odd: AdjustLayer = { id: `${MOOD_LAYER}-2`, kind: 'adjust', name: 'Mood', ripple: false, items: items.filter((_, index) => index % 2 === 1) };
  const layers = cleared.layers;
  const at = layers.findIndex((layer) => layer.kind === 'text' || layer.kind === 'captions');
  const place = at < 0 ? layers.length : at;
  return { ...cleared, layers: [...layers.slice(0, place), even, ...(odd.items.length ? [odd] : []), ...layers.slice(place)] };
}
