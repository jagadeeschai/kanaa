/**
 * Captions that keep clear of faces: a caption that would cover someone's face moves to the top (or middle) for its
 * time only. Face paths come from the face finder (backend face_service.find_faces) for each video on the main track.
 */
import { valueAt } from './evaluate.ts';
import { captionLayers, clipLength, fittedSize, mainLayer, type Caption, type CaptionLayer, type Clip, type Format, type Timeline } from './model.ts';

/** One face over time: [source seconds, x, y, width, height], 0 to 1 across the picture, from the face finder. */
export type FacePath = number[][];
type Box = { top: number; bottom: number };
type Place = 'top' | 'center' | 'bottom';

/** Where caption lines sit, as a share of the frame's height (with room for two lines). */
export const CAPTION_BANDS: Record<Place, Box> = { top: { top: 0.03, bottom: 0.3 }, center: { top: 0.38, bottom: 0.62 }, bottom: { top: 0.7, bottom: 0.97 } };

/** The faces on screen at timeline time `t` in this clip, as vertical spans of the frame. */
export function facesOnScreen(clip: Clip, paths: FacePath[], source: { width: number; height: number }, format: Format, t: number): Box[] {
  if ((clip.adjust.rotation ?? 0) % 360) return [];
  const local = t - clip.start;
  if (local < 0 || local > clipLength(clip)) return [];
  const sourceTime = clip.freeze ?? (clip.reverse ? clip.out - local * clip.speed : clip.in + local * clip.speed);
  const fitted = fittedSize(source, 0, format);
  const scale = valueAt(clip.transform, 'scale', local);
  const middle = valueAt(clip.transform, 'y', local);
  const shown = fitted.height * scale / format.height;
  const boxes: Box[] = [];
  for (const path of paths) {
    if (!path.length || sourceTime < path[0][0] - 0.05 || sourceTime > path[path.length - 1][0] + 0.05) continue;
    const row = path.reduce((best, point) => (Math.abs(point[0] - sourceTime) < Math.abs(best[0] - sourceTime) ? point : best));
    const centre = middle + (row[2] - 0.5) * shown;
    boxes.push({ top: centre - row[4] * shown / 2, bottom: centre + row[4] * shown / 2 });
  }
  return boxes;
}

const overlaps = (a: Box, b: Box) => a.top < b.bottom && b.top < a.bottom;

/** The caption's place: its layer's when that is clear, else the first clear one of bottom, top and middle, else its layer's. */
export function clearPlace(layer: CaptionLayer, faces: Box[]): Place | null {
  const order: Place[] = [layer.position, ...(['bottom', 'top', 'center'] as Place[]).filter((place) => place !== layer.position)];
  const clear = order.find((place) => !faces.some((face) => overlaps(face, CAPTION_BANDS[place])));
  return !clear || clear === layer.position ? null : clear;
}

/**
 * Every caption placed clear of the faces under it, checked at its start, middle and end.
 * `faces` gives each main-track clip's face paths, by clip id. Returns the timeline and how many captions moved.
 */
export function keepCaptionsClear(timeline: Timeline, faces: Map<string, FacePath[]>, source: (mediaId: number) => { width: number; height: number } | undefined): { timeline: Timeline; moved: number } {
  const clips = mainLayer(timeline).items;
  let moved = 0;
  const layers = timeline.layers.map((layer) => {
    if (layer.kind !== 'captions' || layer.locked) return layer;
    const items = layer.items.map((caption): Caption => {
      const boxes = [caption.start + 0.05, caption.start + caption.length / 2, caption.start + caption.length - 0.05].flatMap((t) => {
        const clip = clips.find((item) => t >= item.start && t < item.start + clipLength(item));
        const size = clip && source(clip.media_id);
        return clip && size ? facesOnScreen(clip, faces.get(clip.id) ?? [], size, timeline.format, t) : [];
      });
      const place = clearPlace(layer, boxes);
      if ((place ?? null) !== (caption.position ?? null)) moved += 1;
      const { position: _old, ...rest } = caption;
      return place ? { ...rest, position: place } : rest;
    });
    return { ...layer, items };
  });
  return { timeline: captionLayers(timeline).length ? { ...timeline, layers } : timeline, moved };
}
