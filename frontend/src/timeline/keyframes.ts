import { valueAt, type AnimatedProperty, type Ease, type Keyframe, type Transform } from './evaluate.ts';

/** One control in the inspector. Position is two curves that always get keys together. */
export type Control = 'position' | 'scale' | 'rotation' | 'opacity';
export const CONTROL_PROPERTIES: Record<Control, AnimatedProperty[]> = { position: ['x', 'y'], scale: ['scale'], rotation: ['rotation'], opacity: ['opacity'] };
export const SAME_KEY_SECONDS = 1 / 60;
const round = (value: number) => Math.round(value * 1000) / 1000;

const withKeys = (transform: Transform, property: AnimatedProperty, keys: Keyframe[] | null): Transform => {
  const keyframes = { ...transform.keyframes };
  if (keys?.length) keyframes[property] = keys; else delete keyframes[property];
  return { ...transform, keyframes };
};

export const isAnimated = (transform: Transform, control: Control) => CONTROL_PROPERTIES[control].some((property) => transform.keyframes?.[property]?.length);

export function keyTimes(transform: Transform, control?: Control): number[] {
  const properties = control ? CONTROL_PROPERTIES[control] : (Object.keys(transform.keyframes ?? {}) as AnimatedProperty[]);
  const times = properties.flatMap((property) => transform.keyframes?.[property]?.map((key) => key.t) ?? []);
  return [...new Set(times)].sort((a, b) => a - b);
}

export const hasKeyAt = (transform: Transform, control: Control, t: number) => keyTimes(transform, control).some((time) => Math.abs(time - t) <= SAME_KEY_SECONDS);

function putKey(transform: Transform, property: AnimatedProperty, t: number, v: number, ease?: Ease): Transform {
  const keys = transform.keyframes?.[property] ?? [];
  const same = keys.find((key) => Math.abs(key.t - t) <= SAME_KEY_SECONDS);
  const before = [...keys].reverse().find((key) => key.t < t);
  const next = same ? keys.map((key) => (key === same ? { ...key, v } : key))
    : [...keys, { t: round(t), v, ease: ease ?? before?.ease ?? keys[0]?.ease ?? 'easeInOut' }].sort((a, b) => a.t - b.t);
  return withKeys(transform, property, next);
}

/** The stopwatch. Turning on keeps the current value as the first key; turning off keeps the value at `t`. */
export function toggleAnimated(transform: Transform, control: Control, t: number): Transform {
  const on = isAnimated(transform, control);
  return CONTROL_PROPERTIES[control].reduce((next, property) => {
    const value = valueAt(transform, property, t);
    return on ? { ...withKeys(next, property, null), [property]: value } : putKey(next, property, t, value, 'easeInOut');
  }, transform);
}

/** What editing a value means: a key at the playhead when animated, otherwise the one fixed value. */
export function writeValue(transform: Transform, property: AnimatedProperty, t: number, value: number): Transform {
  return transform.keyframes?.[property]?.length ? putKey(transform, property, t, value) : { ...transform, [property]: value };
}

export function addKey(transform: Transform, control: Control, t: number): Transform {
  return CONTROL_PROPERTIES[control].reduce((next, property) => putKey(next, property, t, valueAt(transform, property, t)), transform);
}

export function removeKey(transform: Transform, control: Control, t: number): Transform {
  return CONTROL_PROPERTIES[control].reduce((next, property) => {
    const value = valueAt(transform, property, t);
    const keys = (next.keyframes?.[property] ?? []).filter((key) => Math.abs(key.t - t) > SAME_KEY_SECONDS);
    return keys.length ? withKeys(next, property, keys) : { ...withKeys(next, property, null), [property]: value };
  }, transform);
}

export function moveKey(transform: Transform, t: number, x: number, y: number): Transform {
  return putKey(putKey(transform, 'x', t, x), 'y', t, y);
}

export function setEase(transform: Transform, control: Control, ease: Ease): Transform {
  return CONTROL_PROPERTIES[control].reduce((next, property) => withKeys(next, property, next.keyframes?.[property]?.map((key) => ({ ...key, ease })) ?? null), transform);
}

const mapCurves = (transform: Transform, map: (keys: Keyframe[], property: AnimatedProperty) => Keyframe[]): Transform => {
  const keyframes = Object.fromEntries(Object.entries(transform.keyframes ?? {}).map(([property, keys]) => [property, map(keys!, property as AnimatedProperty)]));
  return { ...transform, keyframes };
};

/** Keeps the motion on the same footage when a clip's start moves by `seconds`. */
export function shiftKeys(transform: Transform, seconds: number): Transform {
  return mapCurves(transform, (keys, property) => {
    const moved = keys.map((key) => ({ ...key, t: round(key.t + seconds) }));
    const kept = moved.filter((key) => key.t > 0);
    return moved.length === kept.length ? moved : [{ ...keys[0], t: 0, v: valueAt(transform, property, -seconds) }, ...kept];
  });
}

/** Two halves that carry on from the same value at the cut, `t` seconds in. */
export function splitKeys(transform: Transform, t: number): [Transform, Transform] {
  const first = mapCurves(transform, (keys, property) => {
    const kept = keys.filter((key) => key.t < t);
    return kept.length === keys.length ? keys : [...kept, { t: round(t), v: valueAt(transform, property, t) }];
  });
  return [first, shiftKeys(transform, -t)];
}

/** A speed change squeezes or stretches the clip, so its motion must follow. */
export function scaleKeys(transform: Transform, ratio: number): Transform {
  return mapCurves(transform, (keys) => keys.map((key) => ({ ...key, t: round(key.t * ratio) })));
}
