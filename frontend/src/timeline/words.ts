import { mainLayer, removeClip, splitClip, trimClip, type Clip, type Timeline } from './model.ts';

export type Word = { w: string; s: number; e: number };
/** One thing in the transcript: a spoken word, or a long pause (no `text`). Times `from` and `to` are source seconds. */
export type Token = { key: string; clipId: string; text?: string; from: number; to: number };

export const MIN_PAUSE_SECONDS = 0.7;
const KEPT_BREATH = 0.15;
const WORD_MARGIN = 0.04;
const SHORTEST_PIECE = 0.1;

/** Every word still in the video, in timeline order. A word belongs to a clip when its middle is inside. */
export function buildTokens(clips: Clip[], wordsFor: (mediaId: number) => Word[] | undefined): Token[] {
  const tokens: Token[] = [];
  // A frozen or reversed clip has no speech to read.
  for (const clip of [...clips].filter((item) => item.freeze == null && !item.reverse).sort((a, b) => a.start - b.start)) {
    const words = (wordsFor(clip.media_id) ?? []).filter((word) => { const middle = (word.s + word.e) / 2; return middle >= clip.in && middle < clip.out; });
    let cursor = clip.in;
    const pause = (end: number) => { if (end - cursor >= MIN_PAUSE_SECONDS) tokens.push({ key: `${clip.id}:p${cursor}`, clipId: clip.id, from: cursor, to: end }); };
    for (const word of words) {
      const from = Math.max(word.s, clip.in); const to = Math.min(word.e, clip.out);
      pause(from);
      tokens.push({ key: `${clip.id}:${word.s}`, clipId: clip.id, text: word.w, from, to });
      cursor = to;
    }
    if (words.length) pause(clip.out);
  }
  return tokens;
}

export const tokenTime = (clip: Clip, sourceTime: number) => clip.start + (sourceTime - clip.in) / clip.speed;

/** Takes a stretch of source time out of a clip. What follows closes up, like any cut on the main track. */
export function cutSource(timeline: Timeline, clipId: string, from: number, to: number, newId: string): Timeline {
  const clip = mainLayer(timeline).items.find((item) => item.id === clipId);
  if (!clip) return timeline;
  const atStart = from - clip.in < SHORTEST_PIECE;
  const atEnd = clip.out - to < SHORTEST_PIECE;
  if (atStart && atEnd) return removeClip(timeline, clipId);
  if (atStart) return trimClip(timeline, clipId, 'in', to);
  if (atEnd) return trimClip(timeline, clipId, 'out', from);
  const split = splitClip(timeline, clip.start + ((to - clip.in) / clip.speed), newId);
  return split === timeline ? timeline : trimClip(split, clipId, 'out', from);
}

/** Cuts selected tokens, joining neighbours into one cut. Works backward so earlier times stay true. */
export function cutTokens(timeline: Timeline, tokens: Token[], chosen: Set<string>, makeId: () => string): Timeline {
  const runs: { clipId: string; from: number; to: number }[] = [];
  tokens.forEach((token, index) => {
    if (!chosen.has(token.key)) return;
    const before = tokens[index - 1]; const after = tokens[index + 1];
    const spoken = (other?: Token) => other?.clipId === token.clipId && Boolean(other.text);
    // A pause keeps a breath at each end. A word takes a hair of air, without touching its neighbours.
    const start = token.text ? Math.max(token.from - WORD_MARGIN, spoken(before) ? before!.to : -Infinity) : token.from + KEPT_BREATH;
    const end = token.text ? Math.min(token.to + WORD_MARGIN, spoken(after) ? after!.from : Infinity) : token.to - KEPT_BREATH;
    const last = runs[runs.length - 1];
    if (last && last.clipId === token.clipId && chosen.has(before?.key ?? '')) last.to = end;
    else if (end > start) runs.push({ clipId: token.clipId, from: start, to: end });
  });
  return runs.reverse().reduce((current, run) => {
    const clip = mainLayer(current).items.find((item) => item.id === run.clipId);
    if (!clip) return current;
    return cutSource(current, run.clipId, Math.max(clip.in, run.from), Math.min(clip.out, run.to), makeId());
  }, timeline);
}


