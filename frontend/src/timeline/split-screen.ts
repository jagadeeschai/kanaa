/**
 * Split screen reveal (split_screen.py): the next clip slides in beside this one, both play side by side for a moment,
 * then the next one fills the frame. Each picture shows through a window [x, y, w, h], moved [dx, dy], in top-left frame
 * pixels on the two-pixel grid. `direction` is where the new clip travels: left (the default) means it comes from the right.
 */
import type { TransitionDirection } from './animation';

export const SPLIT_SCREEN_OPEN = 0.35, SPLIT_SCREEN_HOLD = 0.65;
/** A split screen needs time to be seen side by side: it starts longer than other transitions. */
export const SPLIT_SCREEN_SECONDS = 1.2;
export type ScreenPart = [number, number, number, number, number, number];

const smooth = (x: number) => { const v = Math.min(1, Math.max(0, x)); return v * v * (3 - 2 * v); };
const even = (value: number) => 2 * Math.floor(value / 2 + 0.5);

/** How much of the frame the new clip has, 0 to 1. */
export function splitScreenAmount(q: number): number {
  if (q < SPLIT_SCREEN_OPEN) return 0.5 * smooth(q / SPLIT_SCREEN_OPEN);
  if (q < SPLIT_SCREEN_HOLD) return 0.5;
  return 0.5 + 0.5 * smooth((q - SPLIT_SCREEN_HOLD) / (1 - SPLIT_SCREEN_HOLD));
}

export function splitScreenParts(q: number, direction: TransitionDirection | null | undefined, width: number, height: number): { a: ScreenPart; b: ScreenPart } {
  const amount = splitScreenAmount(q);
  const vertical = direction === 'up' || direction === 'down';
  const span = vertical ? height : width;
  let old: [number, number], next: [number, number], oldMove: number, newMove: number;
  if (!direction || direction === 'left' || direction === 'up') {
    const edge = even(span * (1 - amount));
    old = [0, edge]; next = [edge, span]; oldMove = -even((span - edge) / 2) || 0; newMove = even(edge / 2);
  } else {
    const edge = even(span * amount);
    old = [edge, span]; next = [0, edge]; oldMove = even(edge / 2); newMove = -even((span - edge) / 2) || 0;  // || 0: no negative zero.
  }
  const window = ([lo, hi]: [number, number], move: number): ScreenPart => (vertical ? [0, lo, width, hi - lo, 0, move] : [lo, 0, hi - lo, height, move, 0]);
  return { a: window(old, oldMove), b: window(next, newMove) };
}

/** The preview's drawing (playback.ts): the new clip through its window on black, the old one through its own over it. */
export const SPLIT_SCREEN_SHADER = `
uniform vec4 screenA, screenB, screenMoves;
bool inWindow(vec2 at, vec4 w) { return at.x >= w.x && at.y >= w.y && at.x < w.x + w.z && at.y < w.y + w.w; }
vec4 splitScreen(vec2 at) {
  vec4 result = vec4(0., 0., 0., 1.);
  if (inWindow(at, screenB)) { vec4 picture = B(at - screenMoves.zw); result = picture + result * (1. - picture.a); }
  if (inWindow(at, screenA)) { vec4 picture = A(at - screenMoves.xy); result = picture + result * (1. - picture.a); }
  return result;
}`;
