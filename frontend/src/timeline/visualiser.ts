/** Music visualiser on the timeline: one Screen layer, its clip spanning the song, so the light moves with the music.
 * The style and colour live in the clip's name, so the panel can show what is on and change or remove it. */
import { MAX_VIDEO_LAYERS, newClip, type Clip, type Sound, type Timeline, type VideoLayer } from './model.ts';

export const VISUALISER_LAYER = 'Visualiser';
export type VisualiserStyle = 'bars' | 'circle' | 'wave';
export const VISUALISER_STYLES: { id: VisualiserStyle; label: string }[] = [{ id: 'bars', label: 'Bars' }, { id: 'circle', label: 'Circle' }, { id: 'wave', label: 'Wave' }];
export const VISUALISER_COLOURS = ['#7dd3fc', '#ffd54a', '#f472b6', '#a78bfa', '#4ade80', '#ffffff'];

/** The song the visualiser follows: the longest uploaded song on an audio layer. */
export function songOf(timeline: Timeline): Sound | null {
  const songs = timeline.layers.flatMap((layer) => layer.kind === 'audio' && !layer.muted ? layer.items.filter((sound) => sound.asset_id && !sound.muted) : []);
  return songs.sort((a, b) => (b.out - b.in) / b.speed - (a.out - a.in) / a.speed)[0] ?? null;
}

const isVisualiser = (layer: Timeline['layers'][number]): layer is VideoLayer => layer.kind === 'video' && layer.name === VISUALISER_LAYER;

export function currentVisualiser(timeline: Timeline): { style: VisualiserStyle; colour: string } | null {
  const clip = timeline.layers.find(isVisualiser)?.items[0];
  const match = clip?.name?.match(/^Visualiser · (bars|circle|wave) · (#[0-9a-f]{6})$/i);
  return match ? { style: match[1] as VisualiserStyle, colour: match[2].toLowerCase() } : null;
}

export function removeVisualiser(timeline: Timeline): Timeline {
  return { ...timeline, layers: timeline.layers.filter((layer) => !isVisualiser(layer)) };
}

/** Lays the made visualiser video over the song's time, replacing any earlier one (keeping where it was moved to). */
export function placeVisualiser(timeline: Timeline, song: Sound, made: { id: number; duration?: number | null; width?: number | null; height?: number | null },
  style: VisualiserStyle, colour: string, ids: { clip: string; layer: string }): Timeline {
  const length = Math.round(((song.out - song.in) / song.speed) * 1000) / 1000;
  const before = timeline.layers.find(isVisualiser);
  const clip: Clip = { ...newClip({ media_id: made.id, media_type: 'video', duration: made.duration ?? length, width: made.width ?? undefined, height: made.height ?? undefined }, ids.clip),
    start: song.start, in: 0, out: length, muted: true, volume: 0, name: `Visualiser · ${style} · ${colour.toLowerCase()}` };
  if (before?.items[0]) clip.transform = structuredClone(before.items[0].transform);
  if (before) return { ...timeline, layers: timeline.layers.map((layer) => (layer === before ? { ...before, items: [clip] } : layer)) };
  if (timeline.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`The visualiser needs its own layer; use up to ${MAX_VIDEO_LAYERS} video layers. Delete an overlay layer first.`);
  // Above every picture layer, under the words.
  const lastVideo = timeline.layers.map((layer) => layer.kind).lastIndexOf('video');
  const layer: VideoLayer = { id: ids.layer, kind: 'video', name: VISUALISER_LAYER, blend: 'screen', items: [clip] };
  return { ...timeline, layers: [...timeline.layers.slice(0, lastVideo + 1), layer, ...timeline.layers.slice(lastVideo + 1)] };
}
