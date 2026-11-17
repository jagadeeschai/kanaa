import { valueAt, type AnimatedProperty, type Ease, type Keyframe, type Transform } from './evaluate.ts';
import { fittedSize, type Format } from './model.ts';

/** One-click moves. Each is ordinary keyframes, so it can be adjusted, undone and exported like any other. */
export type MovePreset = 'push-in' | 'pull-out' | 'punch-in' | 'shake' | 'pan-right' | 'pan-left' | 'ken-burns' | 'focus-drift';

const PUSH = 1.15;
const PUNCH = 1.25;
const PAN_ZOOM = 1.2;  // Big enough that a pan never shows the picture's edge.
const PAN_REACH = 0.07;  // How far a pan travels each way from the middle, of the frame (within (PAN_ZOOM - 1) / 2).
const PUNCH_SECONDS = 0.12;
const FOCUS_PUSH = 1.2;  // Focus drift: how much closer it ends.
const FOCUS_PULL = 0.35;  // Focus drift: how far the subject travels towards the middle of the frame.
const FOCUS_COVER = 1.04;  // Focus drift: the least zoom at which the picture still covers the frame, with a little spare.
const SHAKE_SECONDS = 0.5;
const SHAKE_STEP = 1 / 15;
const SHAKE_REACH = 0.015; // Of the frame.
const SHAKE_TURN = 1.5; // Degrees.
const SHAKE_ZOOM = 1.06; // Hides the frame's edges while it shakes.
const round = (value: number) => Math.round(value * 10000) / 10000;

/** Replaces one property's keys between `from` and `to`, keeping the rest and the value either side. */
function place(transform: Transform, property: AnimatedProperty, from: number, to: number, keys: Keyframe[]): Transform {
  const old = transform.keyframes?.[property] ?? [];
  const outside = old.filter((key) => key.t < from - 1e-3 || key.t > to + 1e-3);
  const merged = [...outside, ...keys.map((key) => ({ ...key, t: round(key.t), v: round(key.v) }))].sort((a, b) => a.t - b.t)
    .filter((key, index, all) => index === 0 || key.t > all[index - 1].t);
  return { ...transform, keyframes: { ...transform.keyframes, [property]: merged } };
}

const key = (t: number, v: number, ease: Ease = 'easeInOut'): Keyframe => ({ t, v, ease });

/** Where the faces are, from 0 to 1 across the picture itself (from the backend's face finder). */
export type Focus = { x: number; y: number };

/**
 * Where a point of the picture shows on screen, from 0 to 1 across the frame, at the start of the item.
 * Kept inside the frame: zooming in about a point inside the frame never uncovers its edges.
 * Null for a turned picture, whose sides are swapped.
 */
export function focusOnScreen(transform: Transform, focus: Focus, source: { width: number; height: number }, rotation: number, format: Format): Focus | null {
  if (rotation % 360) return null;
  const fitted = fittedSize(source, 0, format);
  const scale = valueAt(transform, 'scale', 0);
  const clamp = (value: number) => Math.min(0.92, Math.max(0.08, value));
  return { x: clamp(valueAt(transform, 'x', 0) + (focus.x - 0.5) * fitted.width * scale / format.width),
    y: clamp(valueAt(transform, 'y', 0) + (focus.y - 0.5) * fitted.height * scale / format.height) };
}

/** `local` is the playhead's time in the item; `length` is the item's. `aim`, a point on screen, is what a push-in moves towards (usually faces).
 * `wide`: the picture's width as a share of the frame's at size 1 (a 3:2 photo in a 16:9 video is 0.84), so a pan zooms enough to never show an edge. */
export function applyMove(transform: Transform, preset: MovePreset, local: number, length: number, aim?: Focus | null, wide = 1, tall = 1): Transform {
  if (preset === 'focus-drift') {
    if (!aim) return applyMove(transform, 'ken-burns', local, length, null, wide, tall);
    return focusDrift(transform, length, aim, wide, tall);
  }
  if (preset === 'pan-right' || preset === 'pan-left' || preset === 'ken-burns') {
    // Over the whole clip: the camera travels across the picture (it moves the other way on screen), slightly zoomed so
    // no edge shows. Ken Burns also pushes in slowly while it drifts.
    const base = round(Math.max(valueAt(transform, 'scale', 0), PAN_ZOOM, (1 + 2 * PAN_REACH + 0.02) / Math.max(0.1, wide)));
    const x = valueAt(transform, 'x', 0);
    const toRight = preset !== 'pan-left';
    const [from, to] = toRight ? [x + PAN_REACH, x - PAN_REACH] : [x - PAN_REACH, x + PAN_REACH];
    const ease: Ease = preset === 'ken-burns' ? 'easeInOut' : 'linear';
    const drift = preset === 'ken-burns' ? [x + PAN_REACH / 2, x - PAN_REACH / 2] : [from, to];
    const sizes = preset === 'ken-burns' ? [base, base * PUSH] : [base, base];
    const moved = place(transform, 'x', 0, length, [key(0, drift[0], ease), key(length, drift[1], ease)]);
    return place(moved, 'scale', 0, length, [key(0, sizes[0], ease), key(length, sizes[1], ease)]);
  }
  if (preset === 'push-in' || preset === 'pull-out') {
    const base = valueAt(transform, 'scale', 0);
    const [first, last] = preset === 'push-in' ? [base, base * PUSH] : [base * PUSH, base];
    const zoomed = place(transform, 'scale', 0, length, [key(0, first, 'linear'), key(length, last, 'linear')]);
    if (!aim) return zoomed;
    // Zooming about the aim point keeps it where it is on screen while everything grows around it.
    let aimed = zoomed;
    for (const axis of ['x', 'y'] as const) {
      const rest = valueAt(transform, axis, 0);
      const close = aim[axis] + (rest - aim[axis]) * PUSH;
      const [from, to] = preset === 'push-in' ? [rest, close] : [close, rest];
      aimed = place(aimed, axis, 0, length, [key(0, from, 'linear'), key(length, to, 'linear')]);
    }
    return aimed;
  }
  const start = Math.max(0, Math.min(local, length - PUNCH_SECONDS));
  const size = valueAt(transform, 'scale', start);
  if (preset === 'punch-in') return place(transform, 'scale', start, length, [key(start, size, 'easeOut'), key(Math.min(length, start + PUNCH_SECONDS), size * PUNCH)]);
  // Shake: quick steps that die away, back exactly where it was.
  const end = Math.min(length, start + SHAKE_SECONDS);
  const steps = Math.max(2, Math.floor((end - start) / SHAKE_STEP));
  let shaken = transform;
  for (const [property, reach] of [['x', SHAKE_REACH], ['y', SHAKE_REACH], ['rotation', SHAKE_TURN]] as const) {
    const rest = valueAt(transform, property, start);
    const after = valueAt(transform, property, end);
    const keys = [key(start, rest, 'linear')];
    for (let step = 1; step < steps; step += 1) {
      const wobble = Math.sin(step * 12.9898 + property.length * 78.233) * 43758.5453;
      const sign = (wobble - Math.floor(wobble)) * 2 - 1;
      keys.push(key(start + step * SHAKE_STEP, rest + sign * reach * (1 - step / steps), 'linear'));
    }
    keys.push(key(end, after, 'linear'));
    shaken = place(shaken, property, start, end, keys);
  }
  const zoomed = valueAt(transform, 'scale', start);
  return place(shaken, 'scale', start, end, [key(start, zoomed, 'linear'), key(Math.min(end, start + SHAKE_STEP), zoomed * SHAKE_ZOOM, 'linear'), key(Math.max(start + SHAKE_STEP, end - SHAKE_STEP), zoomed * SHAKE_ZOOM, 'linear'), key(end, valueAt(transform, 'scale', end), 'linear')]);
}

export type Slot = 'left' | 'right' | 'top' | 'bottom';

/** Where a clip goes to fill one half of the frame without cropping: centred in it, as big as fits. */
export function slotPlacement(source: { width: number; height: number }, rotation: number, format: Format, slot: Slot) {
  const fitted = fittedSize(source, rotation, format);
  const wide = slot === 'left' || slot === 'right';
  const [slotWidth, slotHeight] = wide ? [format.width / 2, format.height] : [format.width, format.height / 2];
  const scale = Math.min(slotWidth / fitted.width, slotHeight / fitted.height);
  return { x: slot === 'left' ? 0.25 : slot === 'right' ? 0.75 : 0.5, y: slot === 'top' ? 0.25 : slot === 'bottom' ? 0.75 : 0.5, scale };
}

/**
 * Focus drift: a slow Ken Burns that pushes in on the subject (faces, or the most striking part of the picture) and drifts so
 * it ends nearer the middle of the frame. `aim` is where the subject shows on screen at the start. The picture always covers
 * the frame: `wide` and `tall` are its size as a share of the frame's at scale 1.
 */
export function focusDrift(transform: Transform, length: number, aim: Focus, wide = 1, tall = 1): Transform {
  const start = valueAt(transform, 'scale', 0);
  const first = round(Math.max(start, FOCUS_COVER / Math.max(0.1, wide), FOCUS_COVER / Math.max(0.1, tall)));
  const last = round(first * FOCUS_PUSH);
  let moved = place(transform, 'scale', 0, length, [key(0, first), key(length, last)]);
  for (const axis of ['x', 'y'] as const) {
    const share = axis === 'x' ? wide : tall;
    const fits = (scale: number, value: number) => { const room = Math.max(0, (scale * share - 1) / 2); return Math.min(0.5 + room, Math.max(0.5 - room, value)); };
    const from = fits(first, valueAt(transform, axis, 0));
    const point = Math.min(1, Math.max(0, aim[axis]));
    const target = point + (0.5 - point) * FOCUS_PULL;
    // The subject's point of the picture lands on `target`: the picture's middle sits that far from it, grown by the push.
    const to = fits(last, target - (point - from) * last / first);
    moved = place(moved, axis, 0, length, [key(0, from), key(length, to)]);
  }
  return moved;
}
