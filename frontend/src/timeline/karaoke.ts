/**
 * Karaoke: a lyric line's words light up as they are sung. Word times come from the line's own timing, so no extra
 * work is needed; the export draws the same pictures (karaoke_states in timeline_service.py).
 */
import type { TextItem, Timeline } from './model.ts';
import { findText, updateText } from './model.ts';

export const KARAOKE_COLOUR = '#ffd54a';
/** The last word sung by `local` seconds into a karaoke title, or null before the first. Matches karaoke_states. */
export function karaokeLit(text: TextItem, local: number): number | null {
  const words = text.karaoke?.words;
  if (!words?.length) return null;
  let lit: number | null = null;
  words.forEach((at, index) => { if (local >= at) lit = index; });
  return lit;
}

/**
 * When each word of a line starts, worked out from the line's own timing (no listening needed): the sung part of the
 * line is shared among its words by their length, as longer words take longer to sing. The last ~15% of a line (or
 * its last second) is left for the held note at its end.
 */
export function karaokeWords(text: string, length: number): number[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const sung = Math.max(length * 0.6, Math.min(length * 0.85, length - 0.4));
  const weights = words.map((word) => Math.max(1, [...word.replace(/[^\p{L}\p{M}\p{N}]/gu, '')].length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = 0;
  return weights.map((weight) => { const start = Math.round(at * 1000) / 1000; at += (sung * weight) / total; return start; });
}

/** Karaoke on (in `colour`) or off for each of `ids`, each with word times from its own line. */
export function setKaraoke(timeline: Timeline, ids: string[], colour: string | null): Timeline {
  let next = timeline;
  for (const id of ids) {
    const found = findText(next, id)?.text;
    if (found) next = updateText(next, id, { karaoke: colour ? { color: colour, words: karaokeWords(found.text, found.length) } : null });
  }
  return next;
}
