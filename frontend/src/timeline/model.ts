import type { Transform } from './evaluate';

export type Adjust = { rotation: 0 | 90 | 180 | 270; flip_horizontal: boolean; flip_vertical: boolean; brightness: number; contrast: number; saturation: number };
export type Clip = { id: string; media_id: number; start: number; in: number; out: number; speed: number; volume: number; muted: boolean; transform: Transform; adjust: Adjust };
export type VideoLayer = { id: string; kind: 'video'; name?: string; magnetic?: boolean; hidden?: boolean; muted?: boolean; locked?: boolean; items: Clip[] };
export type OtherLayer = { id: string; kind: 'text' | 'audio'; items: { id: string; start: number; [key: string]: unknown }[]; [key: string]: unknown };
export type Format = { width: number; height: number; fps: number };
export type Timeline = { version: 2; format: Format; layers: (VideoLayer | OtherLayer)[] };
export type SourceFacts = { media_id: number; media_type: 'video' | 'image'; duration?: number | null; width?: number | null; height?: number | null };

export const MIN_CLIP_SECONDS = 0.1;
export const PHOTO_SECONDS = 5;
export const MAX_PHOTO_SECONDS = 600;
export const DEFAULT_ADJUST: Adjust = { rotation: 0, flip_horizontal: false, flip_vertical: false, brightness: 1, contrast: 1, saturation: 1 };

export const FORMATS = [
  { id: 'reels', label: 'Reels, Shorts, TikTok', ratio: '9:16', width: 1080, height: 1920 },
  { id: 'youtube', label: 'YouTube', ratio: '16:9', width: 1920, height: 1080 },
  { id: 'square', label: 'Square post', ratio: '1:1', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait post', ratio: '4:5', width: 1080, height: 1350 },
] as const;

export const clipLength = (clip: Clip) => (clip.out - clip.in) / clip.speed;
const round = (value: number) => Math.round(value * 1000) / 1000;

export function mainLayer(timeline: Timeline): VideoLayer {
  const found = timeline.layers.find((layer): layer is VideoLayer => layer.kind === 'video');
  if (!found) throw new Error('This timeline has no video layer.');
  return found;
}

export function duration(timeline: Timeline): number {
  return timeline.layers.reduce((longest, layer) => Math.max(longest, ...layer.items.map((item) => item.start + ('out' in item ? clipLength(item as Clip) : Number(item.length ?? 0)))), 0);
}

export function emptyTimeline(format: Format): Timeline {
  return { version: 2, format, layers: [{ id: 'main', kind: 'video', name: 'Main', magnetic: true, items: [] }] };
}

/** The main track has no gaps: each clip starts where the last one ends. */
function withClips(timeline: Timeline, clips: Clip[]): Timeline {
  let cursor = 0;
  const packed = clips.map((clip) => {
    const placed = { ...clip, start: round(cursor) };
    cursor += clipLength(clip);
    return placed;
  });
  const main = mainLayer(timeline);
  return { ...timeline, layers: timeline.layers.map((layer) => (layer === main ? { ...main, items: packed } : layer)) };
}

export function clipAt(timeline: Timeline, t: number): Clip | undefined {
  const clips = mainLayer(timeline).items;
  return clips.find((clip) => t >= clip.start && t < clip.start + clipLength(clip)) ?? (t >= duration(timeline) ? clips[clips.length - 1] : undefined);
}

export function newClip(source: SourceFacts, id: string): Clip {
  const length = source.media_type === 'image' ? PHOTO_SECONDS : source.duration ?? PHOTO_SECONDS;
  return { id, media_id: source.media_id, start: 0, in: 0, out: length, speed: 1, volume: 1, muted: false,
    transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 }, adjust: { ...DEFAULT_ADJUST } };
}

// The server omits optional clip fields; everything here relies on them being present.
export function normalizeTimeline(timeline: Timeline): Timeline {
  const layers = timeline.layers.map((layer) => {
    if (layer.kind !== 'video') return layer;
    let cursor = 0;
    const items = layer.items.map((item) => {
      const partial = item as Partial<Clip> & Pick<Clip, 'id' | 'media_id' | 'in' | 'out'>;
      const clip: Clip = { ...partial, start: partial.start ?? 0, speed: partial.speed ?? 1, volume: partial.volume ?? 1, muted: partial.muted ?? false,
        transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, ...partial.transform }, adjust: { ...DEFAULT_ADJUST, ...partial.adjust } };
      if (layer.magnetic) clip.start = cursor;
      cursor = clip.start + clipLength(clip);
      return clip;
    });
    return { ...layer, items };
  });
  return { ...timeline, layers };
}

export function insertClip(timeline: Timeline, clip: Clip, index?: number): Timeline {
  const clips = [...mainLayer(timeline).items];
  clips.splice(index ?? clips.length, 0, clip);
  return withClips(timeline, clips);
}

export function removeClip(timeline: Timeline, id: string): Timeline {
  return withClips(timeline, mainLayer(timeline).items.filter((clip) => clip.id !== id));
}

export function moveClip(timeline: Timeline, id: string, index: number): Timeline {
  const clips = [...mainLayer(timeline).items];
  const from = clips.findIndex((clip) => clip.id === id);
  if (from < 0) return timeline;
  const [clip] = clips.splice(from, 1);
  clips.splice(Math.max(0, Math.min(index, clips.length)), 0, clip);
  return withClips(timeline, clips);
}

export function splitClip(timeline: Timeline, t: number, newId: string): Timeline {
  const clips = mainLayer(timeline).items;
  const index = clips.findIndex((clip) => t > clip.start + MIN_CLIP_SECONDS / clip.speed && t < clip.start + clipLength(clip) - MIN_CLIP_SECONDS / clip.speed);
  if (index < 0) return timeline;
  const clip = clips[index];
  const cut = round(clip.in + (t - clip.start) * clip.speed);
  const next = [...clips];
  next.splice(index, 1, { ...clip, out: cut }, { ...clip, id: newId, in: cut });
  return withClips(timeline, next);
}

/** Moves one edge of a clip. `seconds` is in source time, already limited to what the source allows. */
export function trimClip(timeline: Timeline, id: string, edge: 'in' | 'out', seconds: number, source?: SourceFacts): Timeline {
  const clips = mainLayer(timeline).items.map((clip) => {
    if (clip.id !== id) return clip;
    const end = source?.media_type === 'image' ? MAX_PHOTO_SECONDS : source?.duration ?? clip.out;
    if (edge === 'in') return { ...clip, in: round(Math.max(0, Math.min(seconds, clip.out - MIN_CLIP_SECONDS))) };
    return { ...clip, out: round(Math.min(end, Math.max(seconds, clip.in + MIN_CLIP_SECONDS))) };
  });
  return withClips(timeline, clips);
}

export function updateClip(timeline: Timeline, id: string, changes: Partial<Clip>): Timeline {
  return withClips(timeline, mainLayer(timeline).items.map((clip) => (clip.id === id ? { ...clip, ...changes } : clip)));
}

/** Pulls a time to the nearest snap point when one is within reach. */
export function snap(t: number, points: number[], reach: number): number {
  let best = t;
  let distance = reach;
  for (const point of points) {
    const gap = Math.abs(point - t);
    if (gap <= distance) { best = point; distance = gap; }
  }
  return best;
}

export function snapPoints(timeline: Timeline, playhead: number, except?: string): number[] {
  return [0, playhead, ...mainLayer(timeline).items.filter((clip) => clip.id !== except).flatMap((clip) => [clip.start, clip.start + clipLength(clip)])];
}

/** The size a source fits to inside the frame, before any scaling. */
export function fittedSize(source: { width: number; height: number }, rotation: number, format: Format) {
  const [w, h] = rotation % 180 ? [source.height, source.width] : [source.width, source.height];
  const fit = Math.min(format.width / w, format.height / h);
  return { width: w * fit, height: h * fit };
}

/** The scale that makes a fitted clip fill the whole frame. */
export function fillScale(source: { width: number; height: number }, rotation: number, format: Format): number {
  const fitted = fittedSize(source, rotation, format);
  return Math.max(format.width / fitted.width, format.height / fitted.height);
}

export function exportFormat(format: Format, shortSide: number): Format {
  const factor = shortSide / Math.min(format.width, format.height);
  const even = (value: number) => Math.round((value * factor) / 2) * 2;
  return { ...format, width: even(format.width), height: even(format.height) };
}

export function timecode(seconds: number, fps = 30): string {
  const total = Math.max(0, Math.round(seconds * fps));
  const frames = total % fps;
  const whole = Math.floor(total / fps);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}
