/**
 * One-click moves for a title over its whole length. Each is ordinary keyframes (and, for the crawl, a lean back), so
 * the preview and the export already draw it the same way, and it can be adjusted or undone like any other move.
 */
import { valueAt, type Keyframe, type Transform } from './evaluate.ts';
import { REST_TRANSFORM, type TextItem } from './model.ts';

export type TitleMove = 'drift' | 'drift-sideways' | 'drift-up' | 'ticker' | 'credits' | 'crawl';
export const TITLE_MOVES: { id: TitleMove; label: string; tip: string }[] = [
  { id: 'drift', label: 'Drifting', tip: 'Grows very slowly the whole time it shows' },
  { id: 'drift-sideways', label: 'Sideways drift', tip: 'Glides slowly to the right the whole time' },
  { id: 'drift-up', label: 'Vertical drift', tip: 'Rises slowly the whole time' },
  { id: 'ticker', label: 'Ticker', tip: 'Runs from right to left along the bottom, like a news ticker' },
  { id: 'credits', label: 'Scrolling credits', tip: 'Rolls up from below the frame and out at the top' },
  { id: 'crawl', label: 'Story crawl', tip: 'Leans back and rolls away into the distance' },
];

export const DRIFT_GROW = 1.08;
export const DRIFT_REACH = 0.04; // Of the frame, each way.
export const CRAWL_TILT = 55; // Degrees, the top away.
const MOVED = ['x', 'y', 'scale', 'tilt_x'] as const;
const round = (value: number) => Math.round(value * 10000) / 10000;
const line = (length: number, from: number, to: number): Keyframe[] => [{ t: 0, v: round(from), ease: 'linear' }, { t: round(length), v: round(to), ease: 'linear' }];

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
  const transform: Transform = { ...still, keyframes, ...(move === 'crawl' ? { tilt_x: CRAWL_TILT } : {}) };
  const position: Partial<TextItem> = move === 'ticker' ? { position: 'bottom' } : move === 'credits' || move === 'crawl' ? { position: 'center' } : {};
  // A ticker or credits must start and end out of sight, so an entrance or exit animation would only fight it.
  const plain: Partial<TextItem> = move === 'ticker' || move === 'credits' || move === 'crawl' ? { enter: null, exit: null } : {};
  return { transform, ...position, ...plain };
}
