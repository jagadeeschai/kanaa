/**
 * Multicam on the timeline: recordings of the same moment, lined up by sound (multicam_service.py). The main clip
 * (angle 1) keeps its place and its sound; every other angle goes on its own "Angle N" layer above, lined up and
 * silent, switched off (timed, but not shown). Switching to an angle at a moment cuts every angle layer there and shows
 * only that angle from then until the next switch; angle 1 shows the main clip. Each switch is one step (⌘Z).
 */
import { clipLength, mainLayer, removeClip, REST_TRANSFORM, type Clip, type Timeline, type VideoLayer } from './model.ts';

export const ANGLE_LAYER = 'Angle';
const round = (value: number) => Math.round(value * 1000) / 1000;
export type Synced = { clipId: string; offset: number; duration: number };

const angleId = (refId: string, angle: number) => `${refId}~cam${angle}`;
const isAngleOf = (refId: string) => (layer: Timeline['layers'][number]): boolean =>
  layer.kind === 'video' && (layer.name ?? '').startsWith(ANGLE_LAYER) && layer.items.length > 0 && layer.items.every((item) => item.id.startsWith(`${refId}~cam`));

/** The angle layers of a main clip, in angle order (2, 3, …). */
export function angleLayers(timeline: Timeline, refId: string): VideoLayer[] {
  return (timeline.layers.filter(isAngleOf(refId)) as VideoLayer[]).sort((a, b) => angleNumber(a) - angleNumber(b));
}
const angleNumber = (layer: VideoLayer) => Number(layer.items[0].id.split('~cam')[1].split('.')[0]);

/** The main clip with angles at time `t`, if any. */
export function multicamAt(timeline: Timeline, t: number): Clip | null {
  return mainLayer(timeline).items.find((clip) => t >= clip.start && t < clip.start + clipLength(clip) && angleLayers(timeline, clip.id).length > 0) ?? null;
}

export function cannotMulticam(clip: Clip): string | null {
  if (clip.speed !== 1 || clip.reverse || clip.ramp || clip.freeze != null || clip.slowmo) return 'Multicam lines up clips playing at normal speed (not slowed, sped up, reversed or frozen).';
  return null;
}

/**
 * Lines the angles up under the main clip `refId`: each `synced` clip (from the main track) starts `offset` seconds
 * into the main clip's recording (negative: it started earlier) and lasts `duration` seconds in all. They leave the
 * main track for their own layers, silent and switched off. Angles that don't overlap the main clip are left alone.
 */
export function makeMulticam(timeline: Timeline, refId: string, synced: Synced[], ids: () => string): Timeline {
  const main = mainLayer(timeline);
  const ref = main.items.find((clip) => clip.id === refId);
  if (!ref) return timeline;
  const placed: VideoLayer[] = [];
  const used = new Set<string>();
  synced.forEach((each, k) => {
    const clip = main.items.find((item) => item.id === each.clipId);
    if (!clip) return;
    // Main clip source second s is the angle's second s − offset.
    const from = ref.in - each.offset, to = Math.min(ref.out - each.offset, each.duration);
    const start = Math.max(from, 0);
    if (to - start < 0.2) return;
    const angle = k + 2;
    placed.push({ id: ids(), kind: 'video', name: `${ANGLE_LAYER} ${angle}`, items: [{
      ...clip, id: angleId(refId, angle), name: `${ANGLE_LAYER} ${angle}`, start: round(ref.start + (start - from)), in: round(start), out: round(to), speed: 1,
      muted: true, volume: 0, enabled: false, transform: REST_TRANSFORM, transition_in: null, enter: null, exit: null, fade_in: 0, fade_out: 0,
    }] });
    used.add(clip.id);
  });
  if (!placed.length) return timeline;
  // The angles leave the main track (which closes up, titles and overlays moving with it), then sit above it, lined
  // up with where the main clip now is.
  let next = { ...timeline, layers: timeline.layers.filter((layer) => !isAngleOf(refId)(layer)) };
  for (const id of used) next = removeClip(next, id);
  const nowMain = mainLayer(next);
  const moved = (nowMain.items.find((item) => item.id === refId)?.start ?? ref.start) - ref.start;
  const at = next.layers.findIndex((layer) => layer.id === nowMain.id) + 1;
  const shifted = placed.map((layer) => ({ ...layer, items: layer.items.map((item) => ({ ...item, start: round(item.start + moved) })) }));
  return { ...next, layers: [...next.layers.slice(0, at), ...shifted, ...next.layers.slice(at)] };
}

/** Shows `angle` (1: the main clip) from `t` until the next switch. */
export function switchAngle(timeline: Timeline, refId: string, t: number, angle: number): Timeline {
  const layers = angleLayers(timeline, refId);
  if (!layers.length) return timeline;
  const changed = new Map<string, VideoLayer>();
  for (const layer of layers) {
    const items: Clip[] = [];
    for (const item of layer.items) {
      const end = item.start + clipLength(item);
      if (t > item.start + 0.01 && t < end - 0.01) {  // Cut here: the part before keeps its state.
        const cut = round(item.in + (t - item.start));
        items.push({ ...item, out: cut }, { ...item, id: `${item.id.split('.')[0]}.${Math.round(t * 1000)}`, start: round(t), in: cut, enabled: angleNumber(layer) === angle });
      } else if (Math.abs(item.start - t) <= 0.01) {
        items.push({ ...item, enabled: angleNumber(layer) === angle });
      } else items.push(item);
    }
    changed.set(layer.id, { ...layer, items });
  }
  return { ...timeline, layers: timeline.layers.map((layer) => changed.get(layer.id) ?? layer) };
}

/** Which angle shows at `t` (1: the main clip). */
export function angleAt(timeline: Timeline, refId: string, t: number): number {
  for (const layer of angleLayers(timeline, refId)) {
    const item = layer.items.find((each) => t >= each.start && t < each.start + clipLength(each));
    if (item?.enabled !== false && item) return angleNumber(layer);
  }
  return 1;
}

/** Ends multicam: the angle layers go (⌘Z brings them back). */
export function removeMulticam(timeline: Timeline, refId: string): Timeline {
  return { ...timeline, layers: timeline.layers.filter((layer) => !isAngleOf(refId)(layer)) };
}
