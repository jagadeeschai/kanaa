import { clipLength, cornerPlacement, duration, newClip, REST_TRANSFORM, type Clip, type Corner, type Timeline, type VideoLayer } from './model.ts';

/**
 * A brand watermark: a logo image kept over the whole film. It is an ordinary overlay clip on a layer with a known
 * id, so it previews and exports through the existing overlay path (PNG transparency is kept by both sides) and it
 * can be moved, resized or deleted like any overlay. `coverBrand` stretches it over the full video when the film is
 * played or exported, so the saved recipe never needs to change as the video grows.
 */
export const BRAND_LAYER_ID = 'brand';
/** Clip-level logos live on their own layer, so the always-covering project mark never stretches them. */
export const BRAND_CLIPS_LAYER_ID = 'brand-clips';
export const BRAND_OPACITY = 0.9;
export const BRAND_SIZES = [{ id: 'small', label: 'Small', scale: 0.12 }, { id: 'medium', label: 'Medium', scale: 0.18 }, { id: 'large', label: 'Large', scale: 0.28 }] as const;

export function brandLayer(timeline: Timeline): VideoLayer | null {
  const found = timeline.layers.find((layer): layer is VideoLayer => layer.kind === 'video' && layer.id === BRAND_LAYER_ID);
  return found ?? null;
}

/** A layer carrying a watermark (the project mark or clip-level marks). Drawn above the cinematic finish, below captions. */
export function isBrandLayer(layer: { id: string; kind: string }): boolean {
  return layer.kind === 'video' && (layer.id === BRAND_LAYER_ID || layer.id === BRAND_CLIPS_LAYER_ID);
}

export function brandClip(timeline: Timeline) {
  return brandLayer(timeline)?.items[0] ?? null;
}

/** Puts the logo on the topmost video layer, at the corner, spanning the video as it is now. Any old brand goes first. */
export function applyBrand(timeline: Timeline, source: { media_id: number; width: number; height: number }, corner: Corner, size: number, id: string): Timeline {
  const clip = newClip({ media_id: source.media_id, media_type: 'image', duration: duration(timeline), width: source.width, height: source.height }, id);
  const placed = { ...clip, out: duration(timeline), muted: true, transform: { ...REST_TRANSFORM, ...cornerPlacement(source, 0, timeline.format, size, corner), scale: size, opacity: BRAND_OPACITY } };
  const layer: VideoLayer = { id: BRAND_LAYER_ID, kind: 'video', name: 'Brand', items: [placed] };
  const rest = timeline.layers.filter((entry) => entry.id !== BRAND_LAYER_ID);
  const after = rest.reduce((last, entry, index) => (entry.kind === 'video' ? index : last), -1);
  return { ...timeline, layers: [...rest.slice(0, after + 1), layer, ...rest.slice(after + 1)] };
}

export function removeBrand(timeline: Timeline): Timeline {
  return timeline.layers.some((entry) => entry.id === BRAND_LAYER_ID) ? { ...timeline, layers: timeline.layers.filter((entry) => entry.id !== BRAND_LAYER_ID) } : timeline;
}

/** Which corner the brand sits in now: the nearest corner placement at its current size. */
export function brandCorner(clip: { transform: { x: number; y: number; scale: number } }, source: { width: number; height: number }, format: Timeline['format']): Corner {
  let best: Corner = 'top-right';
  let distance = Infinity;
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as Corner[]) {
    const spot = cornerPlacement(source, 0, format, clip.transform.scale, corner);
    const gap = Math.hypot(spot.x - clip.transform.x, spot.y - clip.transform.y);
    if (gap < distance) { distance = gap; best = corner; }
  }
  return best;
}

const placedBrand = (timeline: Timeline, source: { width: number; height: number }, corner: Corner, size: number, opacity: number): Timeline => {
  const layer = brandLayer(timeline)!;
  const clip = layer.items[0];
  const spot = cornerPlacement(source, 0, timeline.format, size, corner);
  const placed = { ...clip, transform: { ...clip.transform, x: spot.x, y: spot.y, scale: size, opacity } };
  return { ...timeline, layers: timeline.layers.map((entry) => (entry === layer ? { ...layer, items: [placed] } : entry)) };
};

/** Moves the brand to a corner at its current size. */
export function moveBrand(timeline: Timeline, source: { width: number; height: number }, corner: Corner): Timeline {
  const clip = brandClip(timeline);
  return clip ? placedBrand(timeline, source, corner, clip.transform.scale, clip.transform.opacity) : timeline;
}

/** Resizes the brand, keeping the corner it sits in. */
export function resizeBrand(timeline: Timeline, source: { width: number; height: number }, size: number): Timeline {
  const clip = brandClip(timeline);
  return clip ? placedBrand(timeline, source, brandCorner(clip, source, timeline.format), size, clip.transform.opacity) : timeline;
}

/** Sets how see-through the logo is, from 0 (hidden) to 1 (solid). */
export function fadeBrand(timeline: Timeline, opacity: number): Timeline {
  const layer = brandLayer(timeline);
  const clip = layer?.items[0];
  if (!layer || !clip) return timeline;
  return { ...timeline, layers: timeline.layers.map((entry) => (entry === layer ? { ...layer, items: [{ ...clip, transform: { ...clip.transform, opacity } }] } : entry)) };
}

/** The clip-level logos on the film now, in time order. */
export function clipBrands(timeline: Timeline): Clip[] {
  const found = timeline.layers.find((layer): layer is VideoLayer => layer.kind === 'video' && layer.id === BRAND_CLIPS_LAYER_ID);
  return found ? [...found.items].sort((a, b) => a.start - b.start) : [];
}

/** Logos that show while `clip` plays: they start inside its span. */
export function brandsOnClip(timeline: Timeline, clip: Clip): Clip[] {
  const end = clip.start + clipLength(clip);
  return clipBrands(timeline).filter((mark) => mark.start >= clip.start - 1e-6 && mark.start < end - 1e-6);
}

/** Puts a logo over this one clip, at the corner, lasting exactly as long as the clip. It lands on the timeline as an ordinary overlay that can be dragged or removed. */
export function brandOnClip(timeline: Timeline, clip: Clip, source: { media_id: number; width: number; height: number }, corner: Corner, size: number, id: string): Timeline {
  const length = clipLength(clip);
  const mark = newClip({ media_id: source.media_id, media_type: 'image', duration: length, width: source.width, height: source.height }, id);
  const placed: Clip = { ...mark, start: clip.start, out: length, muted: true, transform: { ...REST_TRANSFORM, ...cornerPlacement(source, 0, timeline.format, size, corner), scale: size, opacity: BRAND_OPACITY } };
  const rest = timeline.layers.filter((entry) => entry.id !== BRAND_CLIPS_LAYER_ID);
  const existing = timeline.layers.find((layer): layer is VideoLayer => layer.id === BRAND_CLIPS_LAYER_ID && layer.kind === 'video');
  const layer: VideoLayer = existing ? { ...existing, items: [...existing.items, placed] } : { id: BRAND_CLIPS_LAYER_ID, kind: 'video', name: 'Clip brands', items: [placed] };
  const after = rest.reduce((last, entry, index) => (entry.kind === 'video' && entry.id !== BRAND_LAYER_ID ? index : last), -1);
  return { ...timeline, layers: [...rest.slice(0, after + 1), layer, ...rest.slice(after + 1)] };
}

/** Takes one clip-level logo off. The layer goes when nothing is left. */
export function removeClipBrand(timeline: Timeline, id: string): Timeline {
  const found = timeline.layers.find((layer): layer is VideoLayer => layer.id === BRAND_CLIPS_LAYER_ID && layer.kind === 'video');
  if (!found) return timeline;
  const items = found.items.filter((mark) => mark.id !== id);
  return items.length ? { ...timeline, layers: timeline.layers.map((entry) => (entry === found ? { ...found, items } : entry)) } : { ...timeline, layers: timeline.layers.filter((entry) => entry.id !== BRAND_CLIPS_LAYER_ID) };
}

/** The brand as it plays: starting at zero and lasting the whole film, whatever the saved clip's length says. */
export function coverBrand(timeline: Timeline): Timeline {
  const layer = brandLayer(timeline);
  const clip = layer?.items[0];
  if (!layer || !clip) return timeline;
  const end = duration(timeline);
  if (clip.start === 0 && clip.out - clip.in >= end) return timeline;
  return { ...timeline, layers: timeline.layers.map((entry) => (entry === layer ? { ...layer, items: [{ ...clip, start: 0, out: clip.in + Math.max(end, clip.out - clip.in) }] } : entry)) };
}
