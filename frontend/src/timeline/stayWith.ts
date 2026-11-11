/**
 * A title that stays with moving people: it keeps its distance from them, and grows as they come nearer and shrinks
 * as they walk away, as something beside them in the scene would. From the same coarse grid of where people are that
 * keep-clear uses (people_grid_service.py), it follows the people nearest the title by their head line and body width,
 * read from the whole silhouette, which is far steadier than a small tracked box, with bad samples thrown out and the
 * rest smoothed both ways in time, so it neither wobbles nor lags.
 * The result is ordinary x, y and size keyframes, so the export just plays them.
 */
import { valueAt, type Keyframe, type Transform } from './evaluate.ts';
import type { Clip, Format, StayWith, TextItem } from './model.ts';
import { REST_TRANSFORM } from './model.ts';
import { localAt } from './ramp.ts';
import type { Box } from './title3d.ts';
import { titleRect, unpackGrid, type PeopleGrid } from './keepClear.ts';
import { simplify, sourceToFrame } from './tracking.ts';

type Size = { width: number; height: number };
/** How gently the path is smoothed: a bell about this many seconds either side. */
export const STAY_SMOOTH_SECONDS = 0.3;
/** Before smoothing, each sample becomes the middle one of those this many seconds either side. */
export const STAY_MEDIAN_SECONDS = 0.4;
/** The title never grows or shrinks past these, however near or far they go. */
export const STAY_MIN_SIZE = 0.25, STAY_MAX_SIZE = 4;
/** A group may move this many grid cells between samples and still be the same group. */
const REACH = 6;

/** Groups of touching cells (diagonals count), each as the list of its cell indices. */
export function groups(cells: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(cells.length);
  const out: number[][] = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (!cells[start] || seen[start]) continue;
    const group: number[] = []; const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const index = stack.pop()!; group.push(index);
      const x = index % w, y = (index - x) / w;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        if (cells[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
    out.push(group);
  }
  return out;
}

export type Seen = { u: number; v: number; size: number; box: [number, number, number, number] } | null;
/** The people inside a window of the grid (cells x0..x1, y0..y1): the middle of them across, their head line, and how
 * wide a body is. Head line and body width stay true when legs leave the picture or people spread apart, which the
 * middle and the area of the silhouette do not. */
export function measure(cells: Uint8Array, w: number, h: number, window: [number, number, number, number]): Seen {
  const [x0, y0, x1, y1] = window;
  const runs: number[] = [];
  let count = 0, sum = 0, top = -1, left = w, right = -1, bottom = -1;
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y += 1) {
    let run = 0, inRow = 0;
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1) + 1; x += 1) {
      const on = x <= Math.min(w - 1, x1) && cells[y * w + x];
      if (on) { run += 1; inRow += 1; count += 1; sum += x + 0.5; left = Math.min(left, x); right = Math.max(right, x); }
      else if (run) { runs.push(run); run = 0; }
    }
    if (inRow >= 2 && top < 0) top = y;  // One stray cell is not a head.
    if (inRow) bottom = y;
  }
  if (count < 4 || top < 0) return null;
  runs.sort((p, q) => p - q);
  // The middle of the widths: single arms and two people side by side are left out.
  const middle = runs.slice(Math.floor(runs.length * 0.4), Math.max(Math.floor(runs.length * 0.4) + 1, Math.ceil(runs.length * 0.8)));
  return { u: sum / count / w, v: top / h, size: middle.reduce((total, run) => total + run, 0) / middle.length / w, box: [left, top, right, bottom] };
}

/**
 * The people followed through the grid's samples: at sample `from`, the group nearest (u, v) of the source picture;
 * then, each step either way, whoever is within REACH cells of where they just were. Null where no one is found.
 */
export function followPeople(grid: PeopleGrid, from: number, u: number, v: number): Seen[] {
  const { w, h } = grid;
  const cellsAt = (index: number) => unpackGrid(grid.frames[index], w, h);
  const out: Seen[] = grid.frames.map(() => null);
  const start = cellsAt(from);
  const first = groups(start, w, h).map((group) => {
    const xs = group.map((cell) => cell % w), ys = group.map((cell) => Math.floor(cell / w));
    return measure(start, w, h, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }).filter((seen): seen is Exclude<Seen, null> => Boolean(seen))
    .reduce<Exclude<Seen, null> | null>((best, next) => (!best || Math.hypot(next.u - u, next.v - v) < Math.hypot(best.u - u, best.v - v) ? next : best), null);
  if (!first) return out;
  out[from] = first;
  for (const step of [1, -1]) {
    let last = first, missed = 0;
    for (let index = from + step; index >= 0 && index < grid.frames.length; index += step) {
      // The longer they have been lost, the wider the look around where they were.
      const reach = REACH * Math.min(4, 1 + missed);
      const seen = measure(cellsAt(index), w, h, [last.box[0] - reach, last.box[1] - reach, last.box[2] + reach, last.box[3] + reach]);
      if (!seen) { missed += 1; continue; }
      missed = 0; last = seen; out[index] = seen;
    }
  }
  return out;
}

/** Each value replaced by the middle one of its neighbours, `half` either side: a bad sample or two is thrown out. */
export function medianOf(values: (number | null)[], half: number): (number | null)[] {
  return values.map((value, index) => {
    if (value === null) return null;
    const near = values.slice(Math.max(0, index - half), index + half + 1).filter((other): other is number => other !== null).sort((p, q) => p - q);
    return near[Math.floor(near.length / 2)];
  });
}

/** A bell-weighted average either side of each value (so it does not lag), with gaps filled from their neighbours. */
export function smoothBothWays(values: (number | null)[], sigma: number): number[] {
  const known = values.map((value, index) => (value === null ? -1 : index)).filter((index) => index >= 0);
  if (!known.length) return values.map(() => 0);
  const filled = values.map((value, index) => {
    if (value !== null) return value;
    const before = [...known].reverse().find((k) => k < index), after = known.find((k) => k > index);
    if (before === undefined) return values[after!]!;
    if (after === undefined) return values[before]!;
    return values[before]! + ((values[after]! - values[before]!) * (index - before)) / (after - before);
  });
  if (sigma <= 0) return filled;
  const reach = Math.ceil(sigma * 3);
  return filled.map((_, index) => {
    let sum = 0, weight = 0;
    for (let offset = -reach; offset <= reach; offset += 1) {
      const other = Math.min(filled.length - 1, Math.max(0, index + offset));
      const share = Math.exp(-0.5 * (offset / sigma) ** 2);
      sum += filled[other] * share; weight += share;
    }
    return sum / weight;
  });
}

/** The transform the title had before it stayed with anyone. */
export function beforeStay(text: TextItem): Transform {
  const transform = text.transform ?? REST_TRANSFORM;
  const kept = text.stay_with;
  if (!kept) return transform;
  const keyframes = { ...transform.keyframes };
  for (const [property, keys] of [['x', kept.x_keys], ['y', kept.y_keys], ['scale', kept.scale_keys]] as const) {
    if (keys?.length) keyframes[property] = keys; else delete keyframes[property];
  }
  return { ...transform, x: kept.x, y: kept.y, scale: kept.scale, keyframes };
}

export type StayJob = { text: TextItem; box: Box; format: Format; under: Clip; source: Size; grid: PeopleGrid; at: number };
export type StayResult = { transform: Transform; stay_with: StayWith; lost: number } | null;

/** New x, y and size keys that keep the title with the people nearest it at `at` (the title's own seconds). Null when no one is there. */
export function stayWith(job: StayJob): StayResult {
  const { text, box, format, under, source, grid } = job;
  const base = beforeStay(text);
  const fps = grid.fps || 15;
  const samples = grid.frames.map((_, index) => {
    const timeline = under.start + localAt(under, grid.start + index / fps);
    return { index, timeline, local: timeline - text.start };
  }).filter(({ local }) => local >= -1 / fps && local <= text.length + 1 / fps);
  if (!samples.length) return null;
  const centreOf = (transform: Transform, local: number): [number, number] => { const rect = titleRect(text, transform, box, format, Math.min(text.length, Math.max(0, local)), null); return [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2]; };
  const reference = samples.reduce((best, next) => (Math.abs(next.local - job.at) < Math.abs(best.local - job.at) ? next : best));
  const frameOf = (sample: { timeline: number }, u: number, v: number) => sourceToFrame(under, source, format, sample.timeline - under.start, u, v);
  // The people nearest the title's letters on the frame at that moment.
  const letters = centreOf(base, reference.local);
  const far = (spot: { u: number; v: number }) => { const [x, y] = frameOf(reference, spot.u, spot.v); return Math.hypot((x - letters[0]) * format.width, (y - letters[1]) * format.height); };
  const startCells = unpackGrid(grid.frames[reference.index], grid.w, grid.h);
  const nearest = groups(startCells, grid.w, grid.h).map((group) => ({ u: group.reduce((total, cell) => total + (cell % grid.w) + 0.5, 0) / group.length / grid.w, v: group.reduce((total, cell) => total + Math.floor(cell / grid.w) + 0.5, 0) / group.length / grid.h, count: group.length }))
    .filter((group) => group.count >= 4).reduce<{ u: number; v: number } | null>((best, next) => (!best || far(next) < far(best) ? next : best), null);
  if (!nearest) return null;
  const seen = followPeople(grid, reference.index, nearest.u, nearest.v);
  const sigma = STAY_SMOOTH_SECONDS * fps, half = Math.round(STAY_MEDIAN_SECONDS * fps);
  const window = samples.map((sample) => seen[sample.index]);
  if (!window.some(Boolean)) return null;
  const us = smoothBothWays(medianOf(window.map((s) => s?.u ?? null), half), sigma), vs = smoothBothWays(medianOf(window.map((s) => s?.v ?? null), half), sigma);
  const sizes = smoothBothWays(medianOf(window.map((s) => (s ? Math.log(s.size) : null)), half), sigma).map(Math.exp);
  const here = samples.indexOf(reference);
  const [x0, y0] = frameOf(reference, us[here], vs[here]);
  const scale0 = valueAt(base, 'scale', reference.local);
  const curves = { x: [] as [number, number][], y: [] as [number, number][], scale: [] as [number, number][] };
  samples.forEach((sample, index) => {
    const local = Math.min(text.length, Math.max(0, sample.local));
    const grown = Math.min(STAY_MAX_SIZE, Math.max(STAY_MIN_SIZE, sizes[index] / sizes[here]));
    const [x, y] = frameOf(sample, us[index], vs[index]);
    // Where the letters should be: as far from the people as at the reference, in proportion to their size now.
    const wanted = [x + (letters[0] - x0) * grown, y + (letters[1] - y0) * grown];
    const scale = scale0 * grown;
    // The letters may sit off the middle of the title's own picture (a top or bottom title), and that offset grows with it.
    const off = centreOf({ ...base, keyframes: undefined, x: 0.5, y: 0.5, scale }, local);
    curves.x.push([local, wanted[0] - (off[0] - 0.5)]); curves.y.push([local, wanted[1] - (off[1] - 0.5)]); curves.scale.push([local, scale]);
  });
  const round = (value: number, places = 5) => Math.round(value * 10 ** places) / 10 ** places;
  const keyframes = { ...base.keyframes };
  for (const [property, tolerance] of [['x', 0.5 / format.width], ['y', 0.5 / format.height], ['scale', 0.002]] as const) {
    const keys: Keyframe[] = simplify(curves[property], tolerance).map(([t, v]) => ({ t: round(t, 3), v: round(v), ease: 'linear' as const })).filter((key, index, all) => index === 0 || key.t > all[index - 1].t);
    keyframes[property] = keys.length > 1 ? keys : [...keys, { ...keys[0], t: round(keys[0].t + 1 / format.fps, 3) }];
  }
  const original = text.stay_with ?? { x: base.x, y: base.y, scale: base.scale, x_keys: base.keyframes?.x ?? null, y_keys: base.keyframes?.y ?? null, scale_keys: base.keyframes?.scale ?? null };
  return { transform: { ...base, keyframes }, lost: round(window.filter((s) => !s).length / fps, 1),
    stay_with: { at: round(job.at, 3), x: original.x, y: original.y, scale: original.scale, x_keys: original.x_keys ?? null, y_keys: original.y_keys ?? null, scale_keys: original.scale_keys ?? null } };
}

/** Back to how the title was before it stayed with anyone. */
export function removeStay(text: TextItem): { transform: Transform; stay_with: null } {
  return { transform: beforeStay(text), stay_with: null };
}
