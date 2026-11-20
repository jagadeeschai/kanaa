/**
 * Pop-out (3D) for video: the chosen person, cut out frame by frame (the clip's own people masks), on a layer above the
 * clip, moving toward the camera while the scene behind them dims a little. Video has no filled-in background, so only moves
 * where the cut-out grows over the person in the clip: it never shows them twice.
 */
import { MAX_VIDEO_LAYERS, clipLength, fittedSize, mainLayer, type Clip, type Format, type Timeline, type VideoLayer } from './model.ts';
import type { Transform } from './evaluate.ts';
import { about } from './popout.ts';

export type VideoPopoutPreset = 'forward' | 'dolly' | 'pop';
export const VIDEO_POPOUT_PRESETS: { id: VideoPopoutPreset; label: string; about: string }[] = [
  { id: 'forward', label: 'Comes forward', about: 'The person grows toward you over the clip; the scene stays' },
  { id: 'dolly', label: 'Dolly zoom', about: 'The scene pulls away behind them while they keep their size' },
  { id: 'pop', label: 'Quick pop', about: 'The person jumps forward at the start, then holds: good on a beat' },
];
const POP_SECONDS = 0.6;
const SCENE_DIM = 0.88, SCENE_MUTE = 0.9;  // The scene behind the person, a little darker and calmer.
const round = (value: number) => Math.round(value * 10000) / 10000;

/** [scene, person] moves. `at`: the person's middle, shares of the picture. */
export function videoPopoutMoves(preset: VideoPopoutPreset, at: [number, number], picture: { width: number; height: number }, format: Format, base: number, length: number): [Transform, Transform] {
  const fitted = fittedSize(picture, 0, format);
  const fw = fitted.width / format.width; const fh = fitted.height / format.height;
  const [ax, ay] = at;
  const still = about(base, fw, fh, 0.5, 0.5, 1, 1, length);
  switch (preset) {
    case 'forward': return [about(base, fw, fh, 0.5, 0.5, 1, 1.03, length), about(base, fw, fh, ax, ay, 1, 1.2, length)];
    case 'dolly': return [about(base, fw, fh, ax, ay, 1.2, 1, length), about(base, fw, fh, ax, ay, 1.2, 1.2, length)];
    case 'pop': {
      const grown = about(base, fw, fh, ax, ay, 1, 1.15, Math.min(POP_SECONDS, length));
      // Jump in over the first moment, then hold there to the end.
      for (const property of ['x', 'y', 'scale'] as const) {
        const keys = grown.keyframes?.[property];
        if (keys) keys[1] = { ...keys[1], ease: 'snap' };
      }
      return [still, grown];
    }
  }
}

/** The clip as a scene (softened around the person) and the person's cut-out on a Pop-out layer, right above the
 *  pictures (words in front) or above the words (words behind). Applying again replaces the earlier cut-out. */
export function applyVideoPopout(timeline: Timeline, clipId: string, ids: number[], at: [number, number], picture: { width: number; height: number },
  preset: VideoPopoutPreset, wordsBehind: boolean, personClipId: string, layerId: string): Timeline {
  const main = mainLayer(timeline);
  const index = main.items.findIndex((clip) => clip.id === clipId);
  if (index < 0) throw new Error('Pop-out works on a clip on the main track.');
  if (!ids.length) throw new Error('Choose who pops out.');
  const clip = main.items[index];
  const length = clipLength(clip);
  const base = clip.transform.scale ?? 1;
  const [scene, front] = videoPopoutMoves(preset, at, picture, timeline.format, base, length);
  const pick = { kind: 'people' as const, ids: [...ids].sort((p, q) => p - q) };
  // The scene dims a little behind them, so they lift off it (kept to what the GPU draws). Applying again keeps the first original.
  const original = clip.popout?.original_adjust ?? clip.adjust;
  const popout = { original_media_id: clip.popout?.original_media_id ?? clip.media_id, person_clip_id: personClipId, original_transform: clip.popout?.original_transform ?? clip.transform, softened: true, original_adjust: original };
  const background: Clip = { ...clip, transform: scene, frame_locked: true, popout, adjust: { ...original, brightness: round(original.brightness * SCENE_DIM), saturation: round(original.saturation * SCENE_MUTE) } };
  const next = main.items[index + 1];
  const person: Clip = { ...clip, popout: null, id: personClipId, transform: front, frame_locked: true, transition_in: null, volume: 0, muted: true, enter: null, exit: null,
    cutout: 'remove', cutout_pick: pick, depth_gap: 0, focus_pull: null, name: 'Pop-out person',
    fade_in: clip.transition_in ? clip.transition_in.duration / 2 : 0, fade_out: next?.transition_in ? round(next.transition_in.duration / 2) : 0 };
  const end = clip.start + length;
  const same = (item: Clip) => item.id === clip.popout?.person_clip_id || (Math.abs(item.start - clip.start) < 1e-3 && Math.abs(clipLength(item) - length) < 1e-3);
  let layers = timeline.layers.map((layer) => (layer === main ? { ...main, items: main.items.map((item) => (item.id === clipId ? background : item)) }
    : layer.kind === 'video' && layer.name === 'Pop-out' ? { ...layer, items: layer.items.filter((item) => !same(item)) } : layer))
    .filter((layer) => !(layer.kind === 'video' && layer.name === 'Pop-out' && layer.items.length === 0));
  const mainAt = layers.findIndex((each) => each.id === main.id);
  const lastWords = layers.reduce((last, each, k) => (each.kind === 'text' ? k : last), -1);
  const sideOk = (k: number) => (wordsBehind ? k > lastWords : k < lastWords || lastWords < 0);
  const free = (layer: VideoLayer) => layer.items.every((item) => item.start + clipLength(item) <= clip.start + 1e-6 || end <= item.start + 1e-6);
  const reuse = layers.findIndex((layer, k) => k > mainAt && layer.kind === 'video' && layer.name === 'Pop-out' && sideOk(k) && free(layer as VideoLayer));
  if (reuse >= 0) return { ...timeline, layers: layers.map((layer, k) => (k === reuse ? { ...(layer as VideoLayer), items: [...(layer as VideoLayer).items, person].sort((a, b) => a.start - b.start) } : layer)) };
  if (layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`Use up to ${MAX_VIDEO_LAYERS} video layers. Delete a layer you no longer use, then apply again.`);
  const layer: VideoLayer = { id: layerId, kind: 'video', name: 'Pop-out', items: [person] };
  const place = wordsBehind ? layers.reduce((last, each, k) => (each.kind === 'text' || each.kind === 'video' ? k : last), 0) + 1 : mainAt + 1;
  return { ...timeline, layers: [...layers.slice(0, place), layer, ...layers.slice(place)] };
}
