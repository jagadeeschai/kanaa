/**
 * Smooth music loops: a song shorter than the video carries on to the end instead of stopping. It jumps back by whole
 * bars (4 beats, from backend beat_service.py), from the last full bar near its end to an earlier bar, so the music
 * keeps its rhythm across each join. Every repeat is an ordinary sound: it can be moved, trimmed or deleted.
 */
import { addSound, duration, findSound, removeSound, type Sound, type Timeline } from './model.ts';

/** Where the picture ends (video, titles, captions): the music should last that long. Sounds don't count. */
export function pictureEnd(timeline: Timeline): number {
  return duration({ ...timeline, layers: timeline.layers.filter((layer) => layer.kind !== 'audio') });
}

const BAR = 4;
const JOIN_FADE = 0.03; // Just enough to stop a click at each join.
const END_FADE = 1.5;
const MIN_LOOP = 4; // Seconds: a shorter stretch repeats too often to sound like music.
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The stretch to repeat, in the song's own seconds: whole bars, ending on the last beat before the song ends. */
export function loopRange(beats: number[], from: number, to: number): [number, number] {
  const usable = beats.filter((beat) => beat >= from && beat <= to - 0.2).sort((a, b) => a - b);
  if (usable.length > BAR) {
    const last = usable.length - 1;
    // The earliest beat a whole number of bars before the last one, so the loop is as long (and as varied) as it can be.
    const first = last % BAR;
    if (usable[last] - usable[first] >= MIN_LOOP) return [round(usable[first]), round(usable[last])];
  }
  return [round(from), round(to)]; // No clear beat: the whole song, joined end to start.
}

/** Whether the sound stops before the video ends, so a loop would help. */
export function needsLoop(timeline: Timeline, sound: Sound): boolean {
  const length = sound.source_length ?? sound.out;
  const ends = sound.start + (length - sound.in) / sound.speed;
  return Boolean(sound.asset_id) && ends < pictureEnd(timeline) - 0.5;
}

/** The song repeated to the end of the video, fading out there. `beats` are in the song's own seconds. */
export function loopSound(timeline: Timeline, soundId: string, beats: number[], newId: () => string): { timeline: Timeline; repeats: number } {
  const found = findSound(timeline, soundId);
  const sound = found?.sound;
  if (!sound || found.layer.locked || !needsLoop(timeline, sound)) return { timeline, repeats: 0 };
  const end = pictureEnd(timeline);
  const length = sound.source_length ?? sound.out;
  const [loopIn, loopOut] = loopRange(beats, sound.in, length);
  const pieces: Sound[] = [];
  // The first piece plays from where the song starts now up to the loop's end, then the loop repeats.
  let cursor = sound.start;
  let from = sound.in;
  while (cursor < end - 0.05 && pieces.length < 200) {
    const until = Math.min(loopOut, from + (end - cursor) * sound.speed);
    const piece: Sound = { ...sound, id: pieces.length ? newId() : sound.id, start: round(cursor), in: round(from), out: round(until),
      fade_in: pieces.length ? JOIN_FADE : sound.fade_in, fade_out: JOIN_FADE };
    pieces.push(piece);
    cursor += (until - from) / sound.speed;
    from = loopIn;
  }
  const last = pieces[pieces.length - 1];
  pieces[pieces.length - 1] = { ...last, fade_out: Math.min(END_FADE, (last.out - last.in) / last.speed / 2) };
  let next = removeSound(timeline, soundId);
  for (const piece of pieces) next = addSound(next, piece, newId());
  return { timeline: next, repeats: pieces.length - 1 };
}
