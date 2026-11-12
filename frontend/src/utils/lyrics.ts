export type LyricCue = { start: number; end: number; text: string; review?: boolean; position?: 'top' | 'center' | 'bottom' };

const TIME_STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
// A word cut across two lines leaves the second starting on a vowel sign or virama.
const STARTS_MID_WORD = /^\p{M}/u;
// Past this a line has stopped being sung, even if the next timestamp is far away.
const MAX_SECONDS_PER_LETTER = 0.3;
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
// LRC tags, plus song-structure labels such as [Verse 1] or [Chorus], which are never sung.
const METADATA_LINE = /^\[(?!\d)[^\]]*\]\s*$/;
const SRT_TIMING = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function stampSeconds(minutes: string, seconds: string): number {
  return Number(minutes) * 60 + Number(seconds.replace(':', '.'));
}

function stripStamps(line: string): string {
  return line.replace(TIME_STAMP, '').replace(WORD_STAMP, '').trim();
}

function isSrt(text: string): boolean {
  return SRT_TIMING.test(text);
}

function parseSrt(text: string): { start: number; end: number; text: string }[] {
  const seconds = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
  const cues = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => SRT_TIMING.test(line));
    if (timingIndex < 0) continue;
    const match = SRT_TIMING.exec(lines[timingIndex])!;
    const words = lines.slice(timingIndex + 1).map((line) => line.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('\n');
    if (words) cues.push({ start: seconds(match[1], match[2], match[3], match[4]), end: seconds(match[5], match[6], match[7], match[8]), text: words });
  }
  return cues;
}

export function hasLyricTimings(text: string): boolean {
  return isSrt(text) || new RegExp(TIME_STAMP.source).test(text);
}

export function plainLyricLines(text: string): string[] {
  if (isSrt(text)) return parseSrt(text).flatMap((cue) => cue.text.split('\n'));
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripStamps(raw);
    if (!line || METADATA_LINE.test(line)) continue;
    if (STARTS_MID_WORD.test(line) && lines.length) lines[lines.length - 1] += line;
    else lines.push(line);
  }
  return lines;
}

function parseLrc(text: string, duration: number): LyricCue[] {
  const offset = Number(/^\s*\[offset:\s*([+-]?\d+)\s*\]/im.exec(text)?.[1] ?? 0) / 1000;
  const stamped: { start: number; text: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (METADATA_LINE.test(line.trim())) continue;
    const words = stripStamps(line);
    if (METADATA_LINE.test(words)) continue;
    if (STARTS_MID_WORD.test(words) && stamped.length) {
      stamped[stamped.length - 1].text += words;
      continue;
    }
    for (const stamp of line.matchAll(TIME_STAMP)) stamped.push({ start: Math.max(0, stampSeconds(stamp[1], stamp[2]) - offset), text: words });
  }
  stamped.sort((a, b) => a.start - b.start);
  const merged: { start: number; text: string }[] = [];
  for (const entry of stamped) {
    if (entry.start >= duration) continue;
    const previous = merged[merged.length - 1];
    // Two lines at one time are usually a translation pair, so show them together.
    if (previous && entry.start - previous.start < 0.01) previous.text = [previous.text, entry.text].filter(Boolean).join('\n');
    else merged.push({ ...entry });
  }
  // A timestamp with no words marks where the previous line ends, e.g. an instrumental break.
  return merged.flatMap((entry, index) => {
    if (!entry.text) return [];
    const nextStart = merged[index + 1]?.start ?? duration;
    const longest = entry.text.length * MAX_SECONDS_PER_LETTER + 1.5;
    return [{ start: entry.start, end: Math.min(nextStart, Math.round((entry.start + longest) * 1000) / 1000), text: entry.text }];
  });
}

export function buildLyricTimeline(text: string, duration: number): LyricCue[] {
  if (text.length > 30000) throw new Error('Use lyrics shorter than 30,000 characters.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Load a song or video first.');
  if (hasLyricTimings(text)) {
    const cues = isSrt(text)
      ? parseSrt(text).filter((cue) => cue.start < duration).sort((a, b) => a.start - b.start)
        .map((cue, index, all) => ({ ...cue, end: Math.min(cue.end, all[index + 1]?.start ?? duration, duration) }))
      : parseLrc(text, duration);
    const usable = cues.filter((cue) => cue.end > cue.start);
    if (!usable.length) throw new Error('None of these timings fall inside the song.');
    if (usable.length > 500) throw new Error('Use up to 500 timed lyric lines.');
    return usable;
  }
  const lines = plainLyricLines(text);
  if (!lines.length || lines.length > 500) throw new Error('Use between 1 and 500 lyric lines.');
  return lines.map((line, index) => ({ text: line, start: Math.round(index * duration / lines.length * 1000) / 1000, end: Math.round((index + 1) * duration / lines.length * 1000) / 1000, review: true }));
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function lrcStamp(seconds: number): string {
  const centiseconds = Math.round(seconds * 100);
  return `[${pad(Math.floor(centiseconds / 6000))}:${pad(Math.floor(centiseconds / 100) % 60)}.${pad(centiseconds % 100)}]`;
}

export function cuesToLrc(cues: LyricCue[]): string {
  const lines: string[] = [];
  cues.forEach((cue, index) => {
    lines.push(`${lrcStamp(cue.start)}${cue.text.replace(/\n/g, ' / ')}`);
    const next = cues[index + 1];
    if (!next || next.start - cue.end > 0.5) lines.push(lrcStamp(cue.end));
  });
  return `${lines.join('\n')}\n`;
}

function srtStamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  return `${pad(Math.floor(milliseconds / 3600000))}:${pad(Math.floor(milliseconds / 60000) % 60)}:${pad(Math.floor(milliseconds / 1000) % 60)},${pad(milliseconds % 1000, 3)}`;
}

export function cuesToSrt(cues: LyricCue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${srtStamp(cue.start)} --> ${srtStamp(cue.end)}\n${cue.text}`).join('\n\n')}\n`;
}

export function validateLyricCues(cues: LyricCue[], duration: number): boolean {
  return cues.length > 0 && cues.length <= 500 && cues.every((cue, index) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start && cue.end <= duration + 0.01 && cue.text.trim().length > 0 && cue.text.length <= 500 && (index === 0 || cue.start >= cues[index - 1].end - 0.001));
}

/**
 * Carries existing timings over to edited lyrics. Unchanged lines at the start and end keep
 * theirs; lines changed in between share the time of the lines they replaced, and are flagged
 * for review whenever lines were added or removed.
 */
export function reconcileLyricCues(cues: LyricCue[], text: string): LyricCue[] {
  const lines = plainLyricLines(text);
  if (!cues.length || !lines.length) return [];
  let head = 0;
  while (head < cues.length && head < lines.length && cues[head].text === lines[head]) head += 1;
  let tail = 0;
  while (tail < cues.length - head && tail < lines.length - head && cues[cues.length - 1 - tail].text === lines[lines.length - 1 - tail]) tail += 1;
  const oldMiddle = cues.slice(head, cues.length - tail);
  const newMiddle = lines.slice(head, lines.length - tail);
  if (oldMiddle.length === newMiddle.length) {
    return cues.map((cue, index) => ({ ...cue, text: lines[index] }));
  }
  if (!newMiddle.length) return [...cues.slice(0, head), ...cues.slice(cues.length - tail)];
  // A line inserted between two others takes a share of the line before it, or after it at the start.
  const borrowed = oldMiddle.length ? 0 : head > 0 ? 1 : 0;
  const source = oldMiddle.length ? oldMiddle : cues.slice(head - borrowed, head + (borrowed ? 0 : 1));
  const replaced = oldMiddle.length ? newMiddle : borrowed ? [cues[head - 1].text, ...newMiddle] : [...newMiddle, cues[0].text];
  const start = source[0].start;
  const span = (source[source.length - 1].end - start) / replaced.length;
  const timed = replaced.map((line, index) => ({ start: start + span * index, end: start + span * (index + 1), text: line, review: true }));
  const before = cues.slice(0, oldMiddle.length ? head : head - borrowed);
  const after = oldMiddle.length ? cues.slice(cues.length - tail) : cues.slice(head + (borrowed ? 0 : 1));
  return [...before, ...timed, ...after];
}

const clampCue = (cue: LyricCue, start: number, end: number, duration: number): LyricCue => {
  const s = Math.min(Math.max(0, start), Math.max(0, duration - 0.05));
  return { ...cue, start: Math.round(s * 1000) / 1000, end: Math.round(Math.min(duration, Math.max(s + 0.05, end)) * 1000) / 1000 };
};

/** Lines `from`..`to` (indexes, inclusive) all earlier or later by `seconds`, kept inside the song. */
export function shiftLyricCues(cues: LyricCue[], from: number, to: number, seconds: number, duration: number): LyricCue[] {
  return cues.map((cue, index) => index < from || index > to ? cue : clampCue(cue, cue.start + seconds, cue.end + seconds, duration));
}

/**
 * Two-point sync: line `from` now starts at `fromStart` and line `to` at `toStart`; every line between is spread in
 * proportion, which fixes lyrics that drift (made for a slightly different tempo or version of the song).
 */
export function stretchLyricCues(cues: LyricCue[], from: number, to: number, fromStart: number, toStart: number, duration: number): LyricCue[] {
  const oldFrom = cues[from]?.start, oldTo = cues[to]?.start;
  if (oldFrom === undefined || oldTo === undefined) return cues;
  if (to <= from || Math.abs(oldTo - oldFrom) < 1e-6) return shiftLyricCues(cues, from, to, fromStart - oldFrom, duration);
  const scale = (toStart - fromStart) / (oldTo - oldFrom);
  const map = (t: number) => fromStart + (t - oldFrom) * scale;
  return cues.map((cue, index) => index < from || index > to ? cue : clampCue(cue, map(cue.start), map(cue.end), duration));
}
