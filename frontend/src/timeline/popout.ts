/**
 * Pop-out (3D): a picture clip becomes two layers that move differently. The main clip shows the filled background;
 * a new layer above it holds the cut-out, the same size and place, so at rest the picture looks exactly as before.
 * Each preset gives the two their own moves (backend/app/services/popout.py makes the pictures).
 */
import { MAX_VIDEO_LAYERS, clipLength, fittedSize, mainLayer, type Clip, type Format, type Timeline, type VideoLayer } from './model.ts';
import type { Keyframe, Transform } from './evaluate.ts';

export type PopoutPreset = 'forward' | 'back' | 'dolly' | 'drift' | 'rise';
export const POPOUT_PRESETS: { id: PopoutPreset; label: string; about: string }[] = [
  { id: 'forward', label: 'Comes forward', about: 'The person grows toward you; the scene stays' },
  { id: 'back', label: 'Steps back', about: 'The person recedes into the scene' },
  { id: 'dolly', label: 'Dolly zoom', about: 'The person stays; the scene pulls away behind them' },
  { id: 'drift', label: 'Parallax drift', about: 'Both drift sideways, the person faster: a gentle 3D pan' },
  { id: 'rise', label: 'Rise up', about: 'The person rises and grows: a hero moment' },
];
/** Where the cut-out stands, as shares of the picture (from the backend). */
export type Where = { x: number; top: number; bottom: number; left: number; right: number };
export type PopoutPictures = { backgroundId: number; personId: number; where: Where; width: number; height: number };

const round = (value: number) => Math.round(value * 10000) / 10000;
const keys = (from: number, to: number, length: number): Keyframe[] => [{ t: 0, v: round(from), ease: 'easeInOut' }, { t: round(length), v: round(to), ease: 'easeInOut' }];

/**
 * A move that grows the picture from `k0` to `k1` times its size about one point of it (shares of the picture), so
 * that point stays where it is on screen, plus a slide of `dx`, `dy` (shares of the frame) over the clip.
 */
export function about(base: number, fw: number, fh: number, ax: number, ay: number, k0: number, k1: number, length: number, dx = [0, 0], dy = [0, 0]): Transform {
  const x = (k: number, d: number) => 0.5 + (ax - 0.5) * fw * base * (1 - k) + d;
  const y = (k: number, d: number) => 0.5 + (ay - 0.5) * fh * base * (1 - k) + d;
  const still = k0 === k1 && dx[0] === dx[1] && dy[0] === dy[1];
  return still ? { x: round(x(k0, dx[0])), y: round(y(k0, dy[0])), scale: round(base * k0), opacity: 1, rotation: 0 }
    : { x: round(x(k0, dx[0])), y: round(y(k0, dy[0])), scale: round(base * k0), opacity: 1, rotation: 0,
      keyframes: { scale: keys(base * k0, base * k1, length), x: keys(x(k0, dx[0]), x(k1, dx[1]), length), y: keys(y(k0, dy[0]), y(k1, dy[1]), length) } };
}

/** The two moves for a preset: [background, person]. `base` is the clip's own size at rest. */
export function popoutMoves(preset: PopoutPreset, where: Where, picture: { width: number; height: number }, format: Format, base: number, length: number): [Transform, Transform] {
  const fitted = fittedSize(picture, 0, format);
  const fw = fitted.width / format.width; const fh = fitted.height / format.height;
  const middle = (where.top + where.bottom) / 2;
  const centre = (k0: number, k1: number) => about(base, fw, fh, 0.5, 0.5, k0, k1, length);
  const feet = (k0: number, k1: number, dx?: number[], dy?: number[]) => about(base, fw, fh, where.x, where.bottom, k0, k1, length, dx, dy);
  switch (preset) {
    case 'forward': return [centre(1, 1.03), feet(1, 1.25)];
    case 'back': return [centre(1.03, 1), feet(1.25, 1)];
    // The scene pulls away about the person's middle while they keep their size.
    case 'dolly': return [about(base, fw, fh, where.x, middle, 1.25, 1, length), feet(1, 1)];
    case 'drift': return [about(base, fw, fh, 0.5, 0.5, 1.06, 1.06, length, [0.012, -0.012]), feet(1.06, 1.06, [0.04, -0.04])];
    case 'rise': return [centre(1, 1), feet(1, 1.15, [0, 0], [0, -0.03])];
  }
}

/**
 * The clip with id `clipId` (on the main track) as two layers: the background in its place, the cut-out right above the
 * pictures (words in front of the person) or above the words (words behind the person). Applying again to the same
 * clip replaces its cut-out; the cut-out goes on a Pop-out layer that is free at that time and on the right side of the
 * words, and a new layer is made only when none is.
 */
export function applyPopout(timeline: Timeline, clipId: string, pictures: PopoutPictures, preset: PopoutPreset, wordsBehind: boolean, personClipId: string, layerId: string): Timeline {
  const main = mainLayer(timeline);
  const index = main.items.findIndex((clip) => clip.id === clipId);
  if (index < 0) throw new Error('Pop-out works on a clip on the main track.');
  const clip = main.items[index];
  const length = clipLength(clip);
  const base = clip.transform.scale ?? 1;
  const [back, front] = popoutMoves(preset, pictures.where, pictures, timeline.format, base, length);
  // What it was before any pop-out (applying again keeps the first original), so Remove pop-out can put it back.
  const popout = { original_media_id: clip.popout?.original_media_id ?? clip.media_id, person_clip_id: personClipId, original_transform: clip.popout?.original_transform ?? clip.transform };
  const background: Clip = { ...clip, media_id: pictures.backgroundId, transform: back, frame_locked: true, popout };
  // The cut-out comes and goes with its clip: faded over the transitions the clip has on either side.
  const next = main.items[index + 1];
  const person: Clip = { ...clip, popout: null, id: personClipId, media_id: pictures.personId, transform: front, frame_locked: true, transition_in: null, volume: 0, muted: true,
    fade_in: clip.transition_in ? clip.transition_in.duration / 2 : 0, fade_out: next?.transition_in ? next.transition_in.duration / 2 : 0, in: 0, out: round(length), speed: 1 };
  const end = clip.start + length;
  // This clip's earlier cut-out (same time on a Pop-out layer) goes; a layer left empty goes with it.
  const same = (item: Clip) => item.id === clip.popout?.person_clip_id || (Math.abs(item.start - clip.start) < 1e-3 && Math.abs(clipLength(item) - length) < 1e-3);
  let layers = timeline.layers.map((layer) => (layer === main ? { ...main, items: main.items.map((item) => (item.id === clipId ? background : item)) }
    : layer.kind === 'video' && layer.name === 'Pop-out' ? { ...layer, items: layer.items.filter((item) => !same(item)) } : layer))
    .filter((layer) => !(layer.kind === 'video' && layer.name === 'Pop-out' && layer.items.length === 0));
  const mainAt = layers.findIndex((each) => each.id === main.id);
  const lastWords = layers.reduce((last, each, k) => (each.kind === 'text' ? k : last), -1);
  const sideOk = (k: number) => (wordsBehind ? k > lastWords : k < lastWords || lastWords < 0);
  const free = (layer: VideoLayer) => layer.items.every((item) => item.start + clipLength(item) <= clip.start + 1e-6 || end <= item.start + 1e-6);
  const reuse = layers.findIndex((layer, k) => k > mainAt && layer.kind === 'video' && layer.name === 'Pop-out' && sideOk(k) && free(layer as VideoLayer));
  if (reuse >= 0) {
    layers = layers.map((layer, k) => (k === reuse ? { ...(layer as VideoLayer), items: [...(layer as VideoLayer).items, person].sort((a, b) => a.start - b.start) } : layer));
    return { ...timeline, layers };
  }
  if (layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`Use up to ${MAX_VIDEO_LAYERS} video layers. Delete a layer you no longer use, then apply again.`);
  const layer: VideoLayer = { id: layerId, kind: 'video', name: 'Pop-out', items: [person] };
  const at = wordsBehind ? layers.reduce((last, each, k) => (each.kind === 'text' || each.kind === 'video' ? k : last), 0) + 1 : mainAt + 1;
  return { ...timeline, layers: [...layers.slice(0, at), layer, ...layers.slice(at)] };
}
