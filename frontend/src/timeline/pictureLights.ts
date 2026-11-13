/** A picture's lights (night sky, lamps) laid over its clip: their own Screen layer, the clip's time, size and move, so they stay on the sky and the flames. */
import { clipLength, MAX_VIDEO_LAYERS, newClip, type Clip, type Timeline, type VideoLayer } from './model.ts';

export const PICTURE_LIGHTS_LAYER = 'Picture lights';

export function placePictureLights(timeline: Timeline, clip: Clip, sky: { id: number; duration?: number | null; width?: number | null; height?: number | null }, ids: { clip: string; layer: string }): Timeline {
  const length = clipLength(clip);
  const piece: Clip = { ...newClip({ media_id: sky.id, media_type: 'video', duration: sky.duration ?? length, width: sky.width ?? undefined, height: sky.height ?? undefined }, ids.clip),
    start: clip.start, in: 0, out: Math.round(length * 1000) / 1000, muted: true, transform: structuredClone(clip.transform) };
  const fits = (layer: VideoLayer) => layer.items.every((item) => item.start + clipLength(item) <= piece.start + 1e-6 || piece.start + length <= item.start + 1e-6);
  const free = timeline.layers.find((layer): layer is VideoLayer => layer.kind === 'video' && layer.name === PICTURE_LIGHTS_LAYER && layer.blend === 'screen' && !layer.locked && fits(layer));
  if (free) return { ...timeline, layers: timeline.layers.map((layer) => (layer === free ? { ...free, items: [...free.items, piece].sort((a, b) => a.start - b.start) } : layer)) };
  if (timeline.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`Use up to ${MAX_VIDEO_LAYERS} video layers.`);
  // Right above the main track, under any overlay, so it only lights the picture itself.
  return { ...timeline, layers: [timeline.layers[0], { id: ids.layer, kind: 'video', name: PICTURE_LIGHTS_LAYER, blend: 'screen', items: [piece] }, ...timeline.layers.slice(1)] };
}
