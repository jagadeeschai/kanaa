/**
 * Keeps a title clear of people: from a coarse grid of where people are (people_grid_service.py), finds how far the
 * title must move, each moment, so no one comes within its gap, and writes that as ordinary x/y keyframes. The export
 * just plays those keys, so preview and export agree with nothing new on the backend's drawing side.
 */
import { valueAt, type Keyframe, type Transform } from './evaluate.ts';
import { fittedSize, REST_TRANSFORM, type Clip, type Format, type KeepClear, type TextItem } from './model.ts';
import { localAt } from './ramp.ts';
import { corners, layers, poseAt, DEFAULT_DEPTH_ANGLE, type Box, type Matrix } from './title3d.ts';
import { simplify, sourceToFrame } from './tracking.ts';

export type PeopleGrid = { fps: number; start: number; w: number; h: number; frames: string[] };
export type Direction = Exclude<KeepClear['direction'], 'auto' | 'side'>;
/** The three room choices in the panel: the gap kept and how far the title may go for it. */
export const KEEP_CLEAR_ROOM = {
  snug: { gap: 0.02, max_move: 0.25, label: 'A little' },
  comfortable: { gap: 0.05, max_move: 0.4, label: 'Comfortable' },
  roomy: { gap: 0.09, max_move: 0.55, label: 'Lots' },
} as const;
export type Room = keyof typeof KEEP_CLEAR_ROOM;
export const roomOf = (kept: Pick<KeepClear, 'gap'> | null | undefined): Room => !kept ? 'comfortable' : kept.gap < 0.035 ? 'snug' : kept.gap < 0.07 ? 'comfortable' : 'roomy';
export const DEFAULT_KEEP_CLEAR: Pick<KeepClear, 'gap' | 'direction' | 'max_move'> = { gap: 0.04, direction: 'auto', max_move: 0.35 };
/** The title moves out this long before someone arrives, and waits this long after they leave. */
export const LEAD_SECONDS = 0.4;
const SMOOTH_SECONDS = 0.4;
type Rect = [number, number, number, number];
type Size = { width: number; height: number };

/** A packed grid (pack() in people_grid_service.py): one byte a cell, 1 where a person is. */
export function unpackGrid(packed: string, w: number, h: number): Uint8Array {
  const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
  const cells = new Uint8Array(w * h);
  for (let index = 0; index < cells.length; index += 1) cells[index] = (bytes[index >> 3] >> (7 - (index & 7))) & 1;
  return cells;
}

/** The transform the title had before it was moved aside: what keep-clear works from. */
export function baseTransform(text: TextItem): Transform {
  const transform = text.transform ?? REST_TRANSFORM;
  const kept = text.keep_clear;
  if (!kept) return transform;
  const keyframes = { ...transform.keyframes };
  for (const [property, keys] of [['x', kept.x_keys], ['y', kept.y_keys]] as const) {
    if (keys?.length) keyframes[property] = keys; else delete keyframes[property];
  }
  return { ...transform, x: kept.x, y: kept.y, keyframes };
}

/** The title's letters on the frame at `local`, as shares of the frame: front and back depth layers together. */
export function titleRect(text: TextItem, transform: Transform, box: Box, format: Format, local: number, pin: Matrix | null): Rect {
  const { width, height } = format;
  const frameBox: Box = [box[0] * width, box[1] * height, box[2] * width, box[3] * height];
  const { pose } = poseAt({ ...text, transform }, local);
  const depth = text.depth && text.depth.amount > 0 ? text.depth : null;
  const shares = layers(depth);
  const points = [shares[0], shares[shares.length - 1]].flatMap((share) => corners(pose, frameBox, [width, height], share, depth?.amount ?? 0, pin, depth?.angle ?? DEFAULT_DEPTH_ANGLE));
  const xs = points.map(([x]) => x / width), ys = points.map(([, y]) => y / height);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

type Person = { x: number; y: number; rx: number; ry: number };
/** The occupied cells of one grid sample, as frame points with the half size of a cell. */
function peopleAt(cells: Uint8Array, grid: PeopleGrid, under: Clip, source: Size, format: Format, clipLocal: number): Person[] {
  const fitted = fittedSize(source, under.adjust.rotation, format);
  const scale = valueAt(under.transform, 'scale', clipLocal);
  const rx = (fitted.width * scale) / grid.w / format.width / 2, ry = (fitted.height * scale) / grid.h / format.height / 2;
  // A quarter-turned source swaps which way a cell is wide.
  const [cx, cy] = under.adjust.rotation === 90 || under.adjust.rotation === 270 ? [ry * format.height / format.width, rx * format.width / format.height] : [rx, ry];
  const out: Person[] = [];
  for (let j = 0; j < grid.h; j += 1) for (let i = 0; i < grid.w; i += 1) {
    if (!cells[j * grid.w + i]) continue;
    const [x, y] = sourceToFrame(under, source, format, clipLocal, (i + 0.5) / grid.w, (j + 0.5) / grid.h);
    out.push({ x, y, rx: cx, ry: cy });
  }
  return out;
}

const AXIS: Record<Direction, { axis: 0 | 1; sign: 1 | -1 }> = { up: { axis: 1, sign: -1 }, down: { axis: 1, sign: 1 }, left: { axis: 0, sign: -1 }, right: { axis: 0, sign: 1 } };

/** The smallest move (frame shares, along the direction) that clears everyone, or null when none within `limit` does. */
export function clearShift(rect: Rect, people: Person[], direction: Direction, gapX: number, gapY: number, limit: number): number | null {
  const { axis, sign } = AXIS[direction];
  const [lo, hi, crossLo, crossHi, gap, crossGap] = axis === 1 ? [rect[1], rect[3], rect[0], rect[2], gapY, gapX] : [rect[0], rect[2], rect[1], rect[3], gapX, gapY];
  const blocked: [number, number][] = [];
  for (const person of people) {
    const [c, r, cross, crossR] = axis === 1 ? [person.y, person.ry, person.x, person.rx] : [person.x, person.rx, person.y, person.ry];
    if (cross + crossR < crossLo - crossGap || cross - crossR > crossHi + crossGap) continue;
    // Overlap while lo + sign*s - gap <= c + r and hi + sign*s + gap >= c - r.
    const a = c - r - hi - gap, b = c + r - lo + gap;
    blocked.push(sign === 1 ? [a, b] : [-b, -a]);
  }
  blocked.sort((p, q) => p[0] - q[0]);
  let s = 0;
  for (const [a, b] of blocked) {
    if (a > s) break;
    if (b > s) s = b + 1e-4;
  }
  return s <= limit ? s : null;
}

const room = (rect: Rect, direction: Direction) => direction === 'up' ? rect[1] : direction === 'down' ? 1 - rect[3] : direction === 'left' ? rect[0] : 1 - rect[2];

/** Largest over ±`half` samples, then the average over ±`soft`: never less than the raw shift, and no jumps. */
export function smoothShifts(raw: number[], half: number, soft: number): number[] {
  const held = raw.map((_, index) => Math.max(...raw.slice(Math.max(0, index - half), index + half + 1)));
  return held.map((_, index) => {
    const part = held.slice(Math.max(0, index - soft), index + soft + 1);
    return Math.max(raw[index], part.reduce((sum, value) => sum + value, 0) / part.length);
  });
}

export type ClearJob = { text: TextItem; box: Box; format: Format; under: Clip; source: Size; grid: PeopleGrid; settings: Pick<KeepClear, 'gap' | 'direction' | 'max_move'>; pinAt?: (timeline: number) => Matrix | null };
export type ClearResult = { transform: Transform; keep_clear: KeepClear; direction: Direction; uncleared: [number, number][] };

/** New x/y keys that keep the title clear of people, and the moments where even the largest allowed move does not. */
export function keepClear(job: ClearJob): ClearResult {
  const { text, box, format, under, source, grid, settings } = job;
  const base = baseTransform(text);
  const gapY = settings.gap, gapX = (settings.gap * format.height) / format.width;
  // Each sample: timeline seconds, the title's own seconds, where its letters are, and who is there.
  const samples = grid.frames.map((packed, index) => {
    const timeline = under.start + localAt(under, grid.start + index / grid.fps);
    const local = timeline - text.start;
    return { timeline, local, packed };
  }).filter(({ local }) => local >= -1 / grid.fps && local <= text.length + 1 / grid.fps).map((sample) => {
    const local = Math.min(text.length, Math.max(0, sample.local));
    const pin = job.pinAt?.(sample.timeline) ?? null;
    return { ...sample, local, rect: titleRect(text, base, box, format, local, pin), people: peopleAt(unpackGrid(sample.packed, grid.w, grid.h), grid, under, source, format, sample.timeline - under.start) };
  });
  const plan = (direction: Direction) => {
    const axisLimit = (rect: Rect) => Math.min(direction === 'left' || direction === 'right' ? (settings.max_move * format.height) / format.width : settings.max_move, room(rect, direction));
    const found = samples.map(({ rect, people }) => clearShift(rect, people, direction, gapX, gapY, axisLimit(rect)));
    const raw = found.map((shift, index) => shift ?? axisLimit(samples[index].rect));
    const missed = found.filter((shift) => shift === null).length;
    return { direction, raw, missed, cost: raw.reduce((sum, value) => sum + value, 0) + missed * 10 };
  };
  const candidates: Direction[] = settings.direction === 'auto' ? ['up', 'down', 'left', 'right'] : settings.direction === 'side' ? ['left', 'right'] : [settings.direction];
  const chosen = candidates.map(plan).reduce((best, next) => (next.cost < best.cost ? next : best));
  const fps = grid.fps || 15;
  const shifts = smoothShifts(chosen.raw, Math.round(LEAD_SECONDS * fps), Math.round((SMOOTH_SECONDS / 2) * fps));
  const { axis, sign } = AXIS[chosen.direction];
  const round = (value: number, places = 5) => Math.round(value * 10 ** places) / 10 ** places;
  const keyframes = { ...base.keyframes };
  const moved = shifts.some((shift) => shift > 1e-4);
  for (const property of ['x', 'y'] as const) {
    const along = (property === 'x' ? 0 : 1) === axis;
    if (!along) continue;
    if (!moved) continue;
    const curve = samples.map(({ local }, index): [number, number] => [local, valueAt(base, property, local) + sign * shifts[index]]);
    const tolerance = 0.5 / (property === 'x' ? format.width : format.height);
    const keys: Keyframe[] = simplify(curve, tolerance).map(([t, v]) => ({ t: round(t, 3), v: round(v), ease: 'linear' as const }))
      .filter((key, index, all) => index === 0 || key.t > all[index - 1].t);
    keyframes[property] = keys.length > 1 ? keys : [...keys, { ...keys[0], t: round(keys[0].t + 1 / format.fps, 3) }];
  }
  const transform: Transform = { ...base, keyframes };
  // Check the result as it will be drawn: anywhere still within half the gap is reported.
  const uncleared: [number, number][] = [];
  samples.forEach(({ timeline, local, people }) => {
    const rect = titleRect(text, transform, box, format, local, job.pinAt?.(timeline) ?? null);
    const touching = people.some((p) => p.x + p.rx > rect[0] - gapX / 2 && p.x - p.rx < rect[2] + gapX / 2 && p.y + p.ry > rect[1] - gapY / 2 && p.y - p.ry < rect[3] + gapY / 2);
    if (!touching) return;
    const last = uncleared[uncleared.length - 1];
    if (last && timeline - last[1] <= 1.5 / fps) last[1] = timeline; else uncleared.push([timeline, timeline]);
  });
  const original = text.keep_clear ?? { x: base.x, y: base.y, x_keys: base.keyframes?.x ?? null, y_keys: base.keyframes?.y ?? null };
  return {
    transform,
    direction: chosen.direction,
    uncleared: uncleared.map(([a, b]) => [round(a, 2), round(b, 2)]),
    keep_clear: { ...settings, x: original.x, y: original.y, x_keys: original.x_keys ?? null, y_keys: original.y_keys ?? null },
  };
}

/** Back to how the title moved before keep-clear. */
export function removeKeepClear(text: TextItem): { transform: Transform; keep_clear: null } {
  return { transform: baseTransform(text), keep_clear: null };
}
