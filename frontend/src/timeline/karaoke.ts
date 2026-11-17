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
  if (lit === null || !text.karaoke?.glow) return lit;
  // With a glow, the picture is the word × GLOW_LEVELS + the glow's strength at this moment (glow_picture in timeline_service.py).
  const levels = text.karaoke.levels ?? [];
  const level = levels.length ? levels[Math.min(levels.length - 1, Math.floor(local * GLOW_RATE + 1e-9))] : GLOW_LEVELS - 1;
  return (lit as number) * GLOW_LEVELS + level;
}

/** Sung-word glow: how many strengths, and how often the song's loudness picks one. As timeline_service.py. */
export const GLOW_LEVELS = 3, GLOW_RATE = 10;

/** Every karaoke picture a line shows (karaokeLit's numbers), so the preview can fetch each once. */
export function karaokePictures(text: TextItem): number[] {
  const words = text.karaoke?.words ?? [];
  if (!text.karaoke?.glow) return words.map((_, index) => index);
  const found = new Set<number>();
  const step = 1 / GLOW_RATE;
  for (let local = 0; local < text.length; local += step) { const lit = karaokeLit(text, local); if (lit !== null) found.add(lit); }
  for (const at of words) { const lit = karaokeLit(text, at); if (lit !== null) found.add(lit); }
  return [...found].sort((a, b) => a - b);
}

/**
 * The sung word glows with the music: each line's glow strength, GLOW_RATE times a second, from the song's loudness
 * (`peaks` per second from /video-audio/{id}/peaks), measured against the song's own quiet and loud parts.
 * `songAt` turns a timeline second into the song's own second, or null where it doesn't play.
 */
export function glowLevels(text: TextItem, peaks: number[], perSecond: number, songAt: (t: number) => number | null): number[] {
  const sorted = [...peaks].sort((a, b) => a - b);
  const pick = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  const quiet = pick(0.3), loud = Math.max(quiet + 1, pick(0.95));
  const levels: number[] = [];
  for (let k = 0; k < Math.ceil(text.length * GLOW_RATE); k += 1) {
    const at = songAt(text.start + k / GLOW_RATE);
    if (at === null) { levels.push(0); continue; }
    const from = Math.floor(at * perSecond), to = Math.max(from + 1, Math.floor((at + 1 / GLOW_RATE) * perSecond));
    const value = Math.max(0, ...peaks.slice(from, to));
    const share = Math.min(1, Math.max(0, (value - quiet) / (loud - quiet)));
    levels.push(Math.min(GLOW_LEVELS - 1, Math.floor(share * GLOW_LEVELS)));
  }
  return levels;
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

/** The sung word of every one of `lines` glows with the music (karaoke added where a line has none), or, `off`, stops glowing. */
export function setSungGlow(timeline: Timeline, lines: TextItem[], levelsFor: ((line: TextItem) => number[]) | null): Timeline {
  let next = timeline;
  for (const line of lines) {
    const karaoke = line.karaoke ?? { color: KARAOKE_COLOUR, words: karaokeWords(line.text, line.length) };
    next = updateText(next, line.id, { karaoke: levelsFor ? { ...karaoke, glow: true, levels: levelsFor(line) } : { color: karaoke.color, words: karaoke.words } });
  }
  return next;
}
