import { valueAt, type AnimatedProperty, type Ease, type Keyframe, type Transform } from './evaluate.ts';
import { fittedSize, type Format } from './model.ts';

/** One-click moves. Each is ordinary keyframes, so it can be adjusted, undone and exported like any other. */
export type MovePreset = 'push-in' | 'pull-out' | 'punch-in' | 'shake';

const PUSH = 1.15;
const PUNCH = 1.25;
const PUNCH_SECONDS = 0.12;
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

/** `local` is the playhead's time in the item; `length` is the item's. */
export function applyMove(transform: Transform, preset: MovePreset, local: number, length: number): Transform {
  if (preset === 'push-in' || preset === 'pull-out') {
    const base = valueAt(transform, 'scale', 0);
    const [first, last] = preset === 'push-in' ? [base, base * PUSH] : [base * PUSH, base];
    return place(transform, 'scale', 0, length, [key(0, first, 'linear'), key(length, last, 'linear')]);
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
