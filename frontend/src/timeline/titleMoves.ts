/**
 * One-click moves for a title over its whole length. Each is ordinary keyframes (and, for the crawl, a lean back), so
 * the preview and the export already draw it the same way, and it can be adjusted or undone like any other move.
 */
import { valueAt, type Keyframe, type Transform } from './evaluate.ts';
import { REST_TRANSFORM, type TextItem } from './model.ts';

export type TitleMove = 'drift' | 'drift-sideways' | 'drift-up' | 'ticker' | 'credits' | 'crawl' | 'sway' | 'float' | 'breathe' | 'swing-3d' | 'turn-now-and-then';
export const TITLE_MOVES: { id: TitleMove; label: string; tip: string }[] = [
  { id: 'drift', label: 'Drifting', tip: 'Grows very slowly the whole time it shows' },
  { id: 'drift-sideways', label: 'Sideways drift', tip: 'Glides slowly to the right the whole time' },
  { id: 'drift-up', label: 'Vertical drift', tip: 'Rises slowly the whole time' },
  { id: 'ticker', label: 'Ticker', tip: 'Runs from right to left along the bottom, like a news ticker' },
  { id: 'credits', label: 'Scrolling credits', tip: 'Rolls up from below the frame and out at the top' },
  { id: 'crawl', label: 'Story crawl', tip: 'Leans back and rolls away into the distance' },
  // Keep-alive moves for words that stay up a long time (a title card, a lower-third, credits): small, and repeating.
  { id: 'sway', label: 'Sway', tip: 'Rocks gently from side to side, the whole time' },
  { id: 'float', label: 'Float', tip: 'Bobs softly up and down, as if on water' },
  { id: 'breathe', label: 'Breathe', tip: 'Grows and settles very slightly, over and over' },
  { id: 'swing-3d', label: '3D swing', tip: 'Turns a little away and back, in true 3D' },
  { id: 'turn-now-and-then', label: 'Turn now and then', tip: 'Holds still, then spins round once every few seconds' },
];

export const DRIFT_GROW = 1.08;
export const DRIFT_REACH = 0.04; // Of the frame, each way.
export const CRAWL_TILT = 55; // Degrees, the top away.
const MOVED = ['x', 'y', 'scale', 'tilt_x', 'tilt_y', 'rotation'] as const;
const round = (value: number) => Math.round(value * 10000) / 10000;
const line = (length: number, from: number, to: number): Keyframe[] => [{ t: 0, v: round(from), ease: 'linear' }, { t: round(length), v: round(to), ease: 'linear' }];

/** Back and forth between `a` and `b` every `period` seconds, eased, from 0 to `length`. */
export function wave(length: number, a: number, b: number, period: number): Keyframe[] {
  const keys: Keyframe[] = [];
  for (let at = 0, step = 0; at <= length + 1e-6; at += period / 2, step += 1) keys.push({ t: round(Math.min(at, length)), v: round(step % 2 ? b : a), ease: 'easeInOut' });
  return keys;
}

/** A full turn every `every` seconds, taking `spin` of them; still in between. */
export function turns(length: number, start: number, every: number, spin: number): Keyframe[] {
  const keys: Keyframe[] = [{ t: 0, v: start, ease: 'linear' }];
  let angle = start;
  for (let at = every; at + spin <= length; at += every) {
    keys.push({ t: round(at), v: angle, ease: 'easeInOut' });
    angle += 360;
    keys.push({ t: round(at + spin), v: angle, ease: 'linear' });
  }
  return keys;
}
export const SWAY_DEGREES = 3;
export const SWING_DEGREES = 22;

/** The title still, as it is at `local`: the keys a move writes are gone, and a crawl's lean with them. */
export function stillTitle(text: TextItem, local: number): Partial<TextItem> {
  const transform = text.transform ?? REST_TRANSFORM;
  const keyframes = { ...transform.keyframes };
  const fixed: Partial<Transform> = {};
  for (const property of MOVED) {
    if (!keyframes[property]?.length) continue;
    fixed[property] = round(valueAt(transform, property, local));
    delete keyframes[property];
  }
  if ((fixed.tilt_x ?? transform.tilt_x) === CRAWL_TILT) fixed.tilt_x = 0;
  return { transform: { ...transform, ...fixed, keyframes } };
}

/** The title's changes for a move. Starts from the title as it is at its start, still. */
export function applyTitleMove(text: TextItem, move: TitleMove): Partial<TextItem> {
  const still = { ...(text.transform ?? REST_TRANSFORM), ...stillTitle(text, 0).transform };
  const { length } = text;
  const keyframes = { ...still.keyframes };
  const x = still.x, y = still.y, scale = still.scale;
  if (move === 'drift') keyframes.scale = line(length, scale, scale * DRIFT_GROW);
  else if (move === 'drift-sideways') keyframes.x = line(length, x - DRIFT_REACH, x + DRIFT_REACH);
  else if (move === 'drift-up') keyframes.y = line(length, y + DRIFT_REACH, y - DRIFT_REACH);
  // The title's picture is the whole frame, so moving it by a frame's width or height takes the words fully out.
  else if (move === 'ticker') keyframes.x = line(length, 1.5, -0.5);
  else if (move === 'credits') keyframes.y = line(length, 1.5, -0.5);
  else if (move === 'crawl') { keyframes.y = line(length, 1.25, 0.3); keyframes.scale = line(length, 1.3 * scale, 0.45 * scale); }
  else if (move === 'sway') keyframes.rotation = wave(length, (still.rotation ?? 0) - SWAY_DEGREES, (still.rotation ?? 0) + SWAY_DEGREES, 4);
  else if (move === 'float') keyframes.y = wave(length, y - 0.01, y + 0.01, 3);
  else if (move === 'breathe') keyframes.scale = wave(length, scale, scale * 1.04, 3);
  else if (move === 'swing-3d') keyframes.tilt_y = wave(length, -SWING_DEGREES, SWING_DEGREES, 5);
  else if (move === 'turn-now-and-then') keyframes.rotation = turns(length, still.rotation ?? 0, 6, 1.2);
  const transform: Transform = { ...still, keyframes, ...(move === 'crawl' ? { tilt_x: CRAWL_TILT } : {}) };
  const position: Partial<TextItem> = move === 'ticker' ? { position: 'bottom' } : move === 'credits' || move === 'crawl' ? { position: 'center' } : {};
  // A ticker or credits must start and end out of sight, so an entrance or exit animation would only fight it.
  const plain: Partial<TextItem> = move === 'ticker' || move === 'credits' || move === 'crawl' ? { enter: null, exit: null } : {};
  return { transform, ...position, ...plain };
}
