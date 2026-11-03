import { valueAt, type Keyframe, type Transform } from './evaluate.ts';
import { localAt } from './ramp.ts';
import { clipLength, DEFAULT_BLUR, fittedSize, MIN_CLIP_SECONDS, type BlurBox, type Clip, type Format, type Timeline, type VideoLayer } from './model.ts';

/** One tracked frame: source seconds, then the box's centre and size, 0 to 1 of the source picture. */
export type TrackPoint = [number, number, number, number, number];
export type Follower = { start: number; length: number; transform: Transform };
type Size = { width: number; height: number };

const SAME_TIME = 1e-4;
const SIZE_TOLERANCE = 0.005; // Half a percent of size: finer steps are tracker shake, not movement.
const round = (value: number, places = 5) => Math.round(value * 10 ** places) / 10 ** places;

/** Where a clip shows a source point, as 0 to 1 of the frame. The preview shader's geometry, run forwards. */
export function sourceToFrame(clip: Clip, source: Size, format: Format, local: number, u: number, v: number): [number, number] {
  const { rotation, flip_horizontal: flipX, flip_vertical: flipY } = clip.adjust;
  // The shader samples the source at s from the quad's q. Here s is known, so q is found.
  const [qx, qy] = rotation === 90 ? [1 - v, u] : rotation === 180 ? [1 - u, 1 - v] : rotation === 270 ? [v, 1 - u] : [u, v];
  const px = flipX ? 1 - qx : qx; const py = flipY ? 1 - qy : qy;
  const fitted = fittedSize(source, rotation, format);
  const scale = valueAt(clip.transform, 'scale', local);
  const dx = (px - 0.5) * fitted.width * scale; const dy = (py - 0.5) * fitted.height * scale;
  const turn = (valueAt(clip.transform, 'rotation', local) * Math.PI) / 180;
  const c = Math.cos(turn); const s = Math.sin(turn);
  return [valueAt(clip.transform, 'x', local) + (dx * c - dy * s) / format.width, valueAt(clip.transform, 'y', local) + (dx * s + dy * c) / format.height];
}

/** The source point a clip shows at a frame point. Null when that point is outside the picture. */
export function frameToSource(clip: Clip, source: Size, format: Format, local: number, x: number, y: number): [number, number] | null {
  const { rotation, flip_horizontal: flipX, flip_vertical: flipY } = clip.adjust;
  const fitted = fittedSize(source, rotation, format);
  const scale = valueAt(clip.transform, 'scale', local);
  const turn = (valueAt(clip.transform, 'rotation', local) * Math.PI) / 180;
  const c = Math.cos(turn); const s = Math.sin(turn);
  const ex = (x - valueAt(clip.transform, 'x', local)) * format.width; const ey = (y - valueAt(clip.transform, 'y', local)) * format.height;
  const px = (ex * c + ey * s) / (fitted.width * scale) + 0.5; const py = (-ex * s + ey * c) / (fitted.height * scale) + 0.5;
  const qx = flipX ? 1 - px : px; const qy = flipY ? 1 - py : py;
  const [u, v] = rotation === 90 ? [qy, 1 - qx] : rotation === 180 ? [1 - qx, 1 - qy] : rotation === 270 ? [1 - qy, qx] : [qx, qy];
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : [u, v];
}

/** The topmost video clip showing under an item at `t`. Items on the main track follow nothing. */
export function videoUnder(timeline: Timeline, itemId: string, t: number, isVideo: (mediaId: number) => boolean): Clip | null {
  const position = timeline.layers.findIndex((layer) => (layer.items as { id: string }[]).some((item) => item.id === itemId));
  if (position <= 0) return null;
  for (const layer of timeline.layers.slice(0, position).reverse()) {
    if (layer.kind !== 'video' || layer.hidden) continue;
    const clip = (layer as VideoLayer).items.find((item) => t >= item.start - SAME_TIME && t < item.start + clipLength(item) && isVideo(item.media_id));
    if (clip) return clip;
  }
  return null;
}

/** The topmost visible video clip at `t`, the one people are looking at. */
export function videoAt(timeline: Timeline, t: number, isVideo: (mediaId: number) => boolean): Clip | null {
  for (const layer of [...timeline.layers].reverse()) {
    if (layer.kind !== 'video' || layer.hidden) continue;
    const clip = (layer as VideoLayer).items.find((item) => t >= item.start - SAME_TIME && t < item.start + clipLength(item) && isVideo(item.media_id));
    if (clip) return clip;
  }
  return null;
}

/** A blur box that sits on one found face for as long as it is in the clip, and grows and shrinks with it. */
export function blurForFace(path: TrackPoint[], under: Clip, source: Size, format: Format, id: string): BlurBox | null {
  const timeOf = (seconds: number) => under.start + localAt(under, seconds);
  const inside = path.filter(([seconds]) => timeOf(seconds) >= under.start - SAME_TIME && timeOf(seconds) <= under.start + clipLength(under) + SAME_TIME);
  if (!inside.length) return null;
  const start = round(timeOf(inside[0][0]), 3);
  const length = round(Math.max(MIN_CLIP_SECONDS, timeOf(inside[inside.length - 1][0]) - start + 1 / format.fps), 3);
  const [seconds, u, v, w, h] = inside[0];
  const local = timeOf(seconds) - under.start;
  const [x, y] = sourceToFrame(under, source, format, local, u, v);
  const [left, top] = sourceToFrame(under, source, format, local, u - w / 2, v - h / 2);
  const [right, bottom] = sourceToFrame(under, source, format, local, u + w / 2, v + h / 2);
  const item = { start, length, transform: { ...DEFAULT_BLUR.transform, x, y } };
  return { ...DEFAULT_BLUR, id, start, length, width: Math.min(1, Math.max(0.02, Math.abs(right - left))), height: Math.min(1, Math.max(0.02, Math.abs(bottom - top))),
    transform: followPath(item, under, source, format, inside, { size: true, drawnAt: 0 }) };
}

/** A box drawn on the frame, as the source box under it: centre and size, 0 to 1. */
export function boxInSource(clip: Clip, source: Size, format: Format, local: number, box: [number, number, number, number]): [number, number, number, number] | null {
  const [x, y, w, h] = box;
  const centre = frameToSource(clip, source, format, local, x, y);
  if (!centre) return null;
  const corners = [[x - w / 2, y - h / 2], [x + w / 2, y + h / 2]].map(([cx, cy]) => frameToSource(clip, source, format, local, Math.min(1, Math.max(0, cx)), Math.min(1, Math.max(0, cy))) ?? centre);
  return [centre[0], centre[1], Math.max(0.01, Math.abs(corners[1][0] - corners[0][0])), Math.max(0.01, Math.abs(corners[1][1] - corners[0][1]))];
}

/** Fewest points that stay within `tolerance` of the path (Ramer-Douglas-Peucker). The ends always stay. */
export function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [t0, v0] = points[first]; const [t1, v1] = points[last];
    let worst = -1; let gap = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const [t, v] = points[index];
      const off = Math.abs(v - (v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)));
      if (off > gap) { gap = off; worst = index; }
    }
    if (worst > 0) { keep.add(worst); stack.push([first, worst], [worst, last]); }
  }
  return [...keep].sort((a, b) => a - b).map((index) => points[index]);
}

export type FollowOptions = { size: boolean; drawnAt: number; from?: number };

/**
 * New position (and size) keys that keep the item where it was, relative to the tracked subject.
 * `drawnAt` is the item's own time when the box was drawn. Keys before `from` are kept, for continuing a track.
 */
export function followPath(item: Follower, under: Clip, source: Size, format: Format, points: TrackPoint[], { size, drawnAt, from = 0 }: FollowOptions): Transform {
  const placed = points.map(([seconds, u, v, w, h]) => {
    const t = under.start + localAt(under, seconds);
    const local = t - item.start;
    const [x, y] = sourceToFrame(under, source, format, t - under.start, u, v);
    const [left, top] = sourceToFrame(under, source, format, t - under.start, u - w / 2, v - h / 2);
    const [right, bottom] = sourceToFrame(under, source, format, t - under.start, u + w / 2, v + h / 2);
    return { local, x, y, extent: Math.hypot((right - left) * format.width, (bottom - top) * format.height) };
  }).filter((point) => point.local >= from - SAME_TIME && point.local <= item.length + SAME_TIME);
  if (!placed.length) return item.transform;
  const origin = placed.reduce((best, point) => (Math.abs(point.local - drawnAt) < Math.abs(best.local - drawnAt) ? point : best));
  const offsetX = valueAt(item.transform, 'x', drawnAt) - origin.x; const offsetY = valueAt(item.transform, 'y', drawnAt) - origin.y;
  const baseScale = valueAt(item.transform, 'scale', drawnAt);
  const curve = (values: [number, number][], tolerance: number, low = -Infinity, high = Infinity): Keyframe[] =>
    simplify(values, tolerance).map(([t, v]) => ({ t: round(Math.max(0, t), 3), v: round(Math.min(high, Math.max(low, v))), ease: 'linear' as const }));
  const keyframes = { ...item.transform.keyframes };
  const merge = (property: 'x' | 'y' | 'scale', fresh: Keyframe[]) => {
    const kept = (from > 0 ? keyframes[property] ?? [] : []).filter((key) => key.t < fresh[0].t - SAME_TIME);
    const joined = [...kept, ...fresh].filter((key, index, all) => index === 0 || key.t > all[index - 1].t);
    keyframes[property] = joined.length > 1 ? joined : [...joined, { ...joined[0], t: round(joined[0].t + 1 / format.fps, 3) }];
  };
  merge('x', curve(placed.map((point) => [point.local, point.x + offsetX]), 0.5 / format.width));
  merge('y', curve(placed.map((point) => [point.local, point.y + offsetY]), 0.5 / format.height));
  if (size) merge('scale', curve(placed.map((point) => [point.local, (baseScale * point.extent) / origin.extent]), SIZE_TOLERANCE, 0.01, 8));
  return { ...item.transform, keyframes };
}

/** Stops following: the position stays at what it is at `t`. Size keys stay, as they may be the person's own. */
export function unfollow(transform: Transform, t: number): Transform {
  const keyframes = { ...transform.keyframes };
  const fixed: Partial<Transform> = {};
  for (const property of ['x', 'y'] as const) {
    if (!keyframes[property]?.length) continue;
    fixed[property] = valueAt(transform, property, t);
    delete keyframes[property];
  }
  return { ...transform, ...fixed, keyframes };
}
