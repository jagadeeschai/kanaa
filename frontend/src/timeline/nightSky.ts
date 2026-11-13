/** Night sky sparkle laid over a picture clip: its own Screen layer, the clip's time, size and move, so the stars stay on its sky. */
import { clipLength, MAX_VIDEO_LAYERS, newClip, type Clip, type Timeline, type VideoLayer } from './model.ts';

export const NIGHT_SKY_LAYER = 'Night sky';

export function placeNightSky(timeline: Timeline, clip: Clip, sky: { id: number; duration?: number | null; width?: number | null; height?: number | null }, ids: { clip: string; layer: string }): Timeline {
  const length = clipLength(clip);
  const piece: Clip = { ...newClip({ media_id: sky.id, media_type: 'video', duration: sky.duration ?? length, width: sky.width ?? undefined, height: sky.height ?? undefined }, ids.clip),
    start: clip.start, in: 0, out: Math.round(length * 1000) / 1000, muted: true, transform: structuredClone(clip.transform) };
  const fits = (layer: VideoLayer) => layer.items.every((item) => item.start + clipLength(item) <= piece.start + 1e-6 || piece.start + length <= item.start + 1e-6);
  const free = timeline.layers.find((layer): layer is VideoLayer => layer.kind === 'video' && layer.name === NIGHT_SKY_LAYER && layer.blend === 'screen' && !layer.locked && fits(layer));
  if (free) return { ...timeline, layers: timeline.layers.map((layer) => (layer === free ? { ...free, items: [...free.items, piece].sort((a, b) => a.start - b.start) } : layer)) };
  if (timeline.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`Use up to ${MAX_VIDEO_LAYERS} video layers.`);
  // Right above the main track, under any overlay, so it only lights the picture's sky.
  return { ...timeline, layers: [timeline.layers[0], { id: ids.layer, kind: 'video', name: NIGHT_SKY_LAYER, blend: 'screen', items: [piece] }, ...timeline.layers.slice(1)] };
}
