import type { Animation, LookName, Transition } from './animation';
import type { Chroma } from './chroma';
import type { Transform } from './evaluate';
import { scaleKeys, shiftKeys, splitKeys } from './keyframes.ts';
import { valueAt } from './evaluate.ts';
import { localAt, rampShare, sourceAt, splitRamp, type RampPoint } from './ramp.ts';
import type { EffectId } from './effects.ts';

export type Adjust = { rotation: 0 | 90 | 180 | 270; flip_horizontal: boolean; flip_vertical: boolean; brightness: number; contrast: number; saturation: number };
/** Which of the people, or objects, a cut-out keeps. ids are from the clip's list of them; null keeps them all. */
export type BlurAmount = 'subtle' | 'medium' | 'strong';
/** The focus moves to `to` (null: all of them) `at` source seconds in, of the steadied or reversed copy when there is one, over `length`. */
export type FocusPull = { to: number[] | null; at: number; length: number };
export type CutoutPick = { kind: 'people' | 'objects'; ids: number[] | null };
export type Clip = { id: string; media_id: number; start: number; in: number; out: number; speed: number; volume: number; muted: boolean; fade_in: number; fade_out: number; transform: Transform; adjust: Adjust; frame_locked?: boolean; enter?: Animation | null; exit?: Animation | null; transition_in?: Transition | null; look?: LookName; chroma?: Chroma | null; freeze?: number | null; reverse?: boolean; stabilise?: boolean; ramp?: RampPoint[] | null; cutout?: 'remove' | 'blur' | null; cutout_pick?: CutoutPick | null; blur_amount?: BlurAmount; focus_pull?: FocusPull | null; clean_voice?: boolean; shape_mask?: ShapeMask | null; bypass?: EffectId[] | null };
/** Only the frame inside `points` shows (0 to 1 across and down), with a soft edge `feather` of the frame height. */
export type ShapeMask = { points: [number, number][]; feather: number };
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
export type VideoLayer = { id: string; kind: 'video'; name?: string; magnetic?: boolean; hidden?: boolean; muted?: boolean; locked?: boolean; blend?: BlendMode; items: Clip[] };
export type Sound = { id: string; asset_id?: string; media_id?: number; start: number; in: number; out: number; speed: number; volume: number; muted: boolean; fade_in: number; fade_out: number; duck: boolean; name: string; source_length?: number; clean_voice?: boolean };
export type AudioLayer = { id: string; kind: 'audio'; name?: string; muted?: boolean; hidden?: boolean; locked?: boolean; items: Sound[] };
/** `transform` moves the whole title from where `position` puts it: x and y are its frame's centre, 0.5 when it hasn't moved. */
export type TextItem = { id: string; start: number; length: number; text: string; style: 'outline' | 'shadow' | 'band'; position: 'top' | 'center' | 'bottom'; color: string; size: number; enter?: Animation | null; exit?: Animation | null; transform?: Transform;
  subtitle?: string | null; subtitle_size?: number | null; subtitle_color?: string | null; subtitle_above?: boolean; subtitle_spacing?: number; align?: 'left' | 'center' | 'right'; band_color?: string | null; font?: string | null; tamil_font?: string | null };
export const REST_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
export type TextLayer = { id: string; kind: 'text'; name?: string; hidden?: boolean; muted?: boolean; locked?: boolean; items: TextItem[] };
/** Hides part of the picture under it. `width` and `height` are of the frame, before the transform's scale. */
export type BlurBox = { id: string; start: number; length: number; style: 'blur' | 'pixelate'; shape: 'oval' | 'box'; amount: number; width: number; height: number; transform: Transform };
export type BlurLayer = { id: string; kind: 'blur'; name?: string; hidden?: boolean; muted?: boolean; locked?: boolean; items: BlurBox[] };
/** One caption line. `s` is each word's time from the caption's start. The layer holds the look. */
export type CaptionWord = { w: string; s: number };
/** `position`, when set, places this one caption elsewhere than its layer (for example above a face). */
export type Caption = { id: string; start: number; length: number; words: CaptionWord[]; position?: 'top' | 'center' | 'bottom' | null };
export type CaptionLook = { style: 'outline' | 'shadow' | 'band'; position: 'top' | 'center' | 'bottom'; color: string; highlight: string | null; size: number };
export type CaptionLayer = CaptionLook & { id: string; kind: 'captions'; name?: string; hidden?: boolean; muted?: boolean; locked?: boolean; items: Caption[] };
export const DEFAULT_CAPTION_LOOK: CaptionLook = { style: 'outline', position: 'bottom', color: '#ffffff', highlight: '#ffd400', size: 48 };
export type TrackLayer = VideoLayer | TextLayer | CaptionLayer | BlurLayer | AudioLayer;
export type TrackItem = TextItem | Caption | BlurBox | Sound | Clip;
export type Format = { width: number; height: number; fps: number };
/** A cinematic look over the whole video, under the captions. Each amount 0 (off) to 1. */
export type Finish = { letterbox: boolean; grade: number; glow: number; vignette: number; grain: number };
export const CINEMATIC: Finish = { letterbox: false, grade: 0.7, glow: 0.35, vignette: 0.55, grain: 0.3 };
export type Timeline = { version: 2; format: Format; layers: (VideoLayer | AudioLayer | TextLayer | CaptionLayer | BlurLayer)[]; normalize_audio?: boolean; finish?: Finish | null; lut?: string | null; lut_amount?: number };

/** Each letterbox bar's height as a share of the frame: bars to 2.39:1, only on a landscape or square frame. Matches bar_share in finish_service.py. */
export function barShare(format: { width: number; height: number }): number {
  const aspect = format.width / format.height;
  return aspect >= 1 ? Math.max(0, (1 - aspect / 2.39) / 2) : 0;
}
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

export const audioLayers = (timeline: Timeline) => timeline.layers.filter((layer): layer is AudioLayer => layer.kind === 'audio');

export const textLayers = (timeline: Timeline) => timeline.layers.filter((layer): layer is TextLayer => layer.kind === 'text');
export const captionLayers = (timeline: Timeline) => timeline.layers.filter((layer): layer is CaptionLayer => layer.kind === 'captions');
export const blurLayers = (timeline: Timeline) => timeline.layers.filter((layer): layer is BlurLayer => layer.kind === 'blur');
/** The rows under the main track: text first, then blur boxes, overlays and sound. */
export const overlayLayers = (timeline: Timeline) => timeline.layers.filter((layer): layer is VideoLayer => layer.kind === 'video' && layer !== mainLayer(timeline));
export const trackLayers = (timeline: Timeline): TrackLayer[] => [...captionLayers(timeline), ...textLayers(timeline), ...blurLayers(timeline), ...[...overlayLayers(timeline)].reverse(), ...audioLayers(timeline)];
export const itemLength = (item: TrackItem) => ('length' in item ? item.length : (item.out - item.in) / item.speed);
export const isClip = (item: TrackItem): item is Clip => 'media_id' in item && 'transform' in item;
export const isBlur = (item: TrackItem): item is BlurBox => 'shape' in item;
export const isCaption = (item: TrackItem): item is Caption => 'words' in item;
export const captionText = (caption: Caption) => caption.words.map((word) => word.w).join(' ');

export function findClip(timeline: Timeline, id: string | null): Clip | null {
  for (const layer of timeline.layers) {
    if (layer.kind !== 'video') continue;
    const clip = layer.items.find((item) => item.id === id);
    if (clip) return clip;
  }
  return null;
}

const overlayHolding = (timeline: Timeline, id: string | null) => overlayLayers(timeline).find((layer) => layer.items.some((item) => item.id === id));

export function findText(timeline: Timeline, id: string | null): { text: TextItem; layer: TextLayer } | null {
  for (const layer of textLayers(timeline)) {
    const text = layer.items.find((item) => item.id === id);
    if (text) return { text, layer };
  }
  return null;
}

export function findBlur(timeline: Timeline, id: string | null): { blur: BlurBox; layer: BlurLayer } | null {
  for (const layer of blurLayers(timeline)) {
    const blur = layer.items.find((item) => item.id === id);
    if (blur) return { blur, layer };
  }
  return null;
}

export function findCaption(timeline: Timeline, id: string | null): { caption: Caption; layer: CaptionLayer } | null {
  for (const layer of captionLayers(timeline)) {
    const caption = layer.items.find((item) => item.id === id);
    if (caption) return { caption, layer };
  }
  return null;
}

/** Each moment a caption looks different: [start, end, lit word], in its own seconds. Matches caption_states in timeline_service.py. */
export function captionStates(caption: Caption, highlight: boolean): [number, number, number | null][] {
  if (!highlight) return [[0, caption.length, null]];
  const times = [0, ...caption.words.slice(1).map((word) => word.s), caption.length];
  return caption.words.map((_, index) => [times[index], times[index + 1], index] as [number, number, number]).filter(([start, end]) => end > start);
}

export function updateCaption(timeline: Timeline, id: string, changes: Partial<Caption>): Timeline {
  const found = findCaption(timeline, id);
  return found ? withItems(timeline, found.layer, found.layer.items.map((item) => (item.id === id ? { ...item, ...changes } : item))) : timeline;
}

export function removeCaption(timeline: Timeline, id: string): Timeline {
  const found = findCaption(timeline, id);
  if (!found) return timeline;
  const items = found.layer.items.filter((item) => item.id !== id);
  return items.length ? withItems(timeline, found.layer, items) : { ...timeline, layers: timeline.layers.filter((layer) => layer.id !== found.layer.id) };
}

/** The look of every caption in the layer. */
export function updateCaptionLook(timeline: Timeline, layerId: string, changes: Partial<CaptionLook>): Timeline {
  return { ...timeline, layers: timeline.layers.map((layer) => (layer.id === layerId && layer.kind === 'captions' ? { ...layer, ...changes } : layer)) };
}

/** Replaces all captions, keeping the look the person chose. A new layer goes on top of everything. */
export function setCaptions(timeline: Timeline, items: Caption[], layerId: string): Timeline {
  const existing = captionLayers(timeline)[0];
  if (existing) return items.length ? withItems(timeline, existing, items) : { ...timeline, layers: timeline.layers.filter((layer) => layer.id !== existing.id) };
  return items.length ? { ...timeline, layers: [...timeline.layers, { ...DEFAULT_CAPTION_LOOK, id: layerId, kind: 'captions', name: 'Captions', items }] } : timeline;
}

export function findSound(timeline: Timeline, id: string | null): { sound: Sound; layer: AudioLayer } | null {
  for (const layer of audioLayers(timeline)) {
    const sound = layer.items.find((item) => item.id === id);
    if (sound) return { sound, layer };
  }
  return null;
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
    fade_in: 0, fade_out: 0, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, adjust: { ...DEFAULT_ADJUST } };
}

const SOUND_DEFAULTS = { speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, duck: false, name: '' };
export const MUSIC_VOLUME = 0.6;

// The server omits optional clip fields; everything here relies on them being present.
export function normalizeTimeline(timeline: Timeline): Timeline {
  const layers = timeline.layers.map((layer) => {
    if (layer.kind === 'audio') return { ...layer, items: layer.items.map((item) => ({ ...SOUND_DEFAULTS, ...item })) };
    if (layer.kind === 'text') return { ...layer, items: layer.items.map((item) => ({ ...item, transform: { ...REST_TRANSFORM, ...item.transform } })) };
    if (layer.kind === 'captions') return { ...DEFAULT_CAPTION_LOOK, ...layer };
    if (layer.kind === 'blur') return { ...layer, items: layer.items.map((item) => ({ ...DEFAULT_BLUR, ...item, transform: { ...DEFAULT_BLUR.transform, ...item.transform } })) };
    if (layer.kind !== 'video') return layer;
    let cursor = 0;
    const items = layer.items.map((item) => {
      const partial = item as Partial<Clip> & Pick<Clip, 'id' | 'media_id' | 'in' | 'out'>;
      const clip: Clip = { ...partial, start: partial.start ?? 0, speed: partial.speed ?? 1, volume: partial.volume ?? 1, muted: partial.muted ?? false, fade_in: partial.fade_in ?? 0, fade_out: partial.fade_out ?? 0,
        transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0, ...partial.transform }, adjust: { ...DEFAULT_ADJUST, ...partial.adjust } };
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
  const overlay = overlayHolding(timeline, id);
  if (overlay) {
    const items = overlay.items.filter((clip) => clip.id !== id);
    return items.length ? withItems(timeline, overlay, items) : { ...timeline, layers: timeline.layers.filter((layer) => layer.id !== overlay.id) };
  }
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

/** Holds the frame at `t` for `seconds`, between the two halves of the clip there. */
export function freezeFrame(timeline: Timeline, t: number, ids: [string, string], seconds = 2): Timeline {
  const clips = mainLayer(timeline).items;
  const clip = clips.find((item) => t >= item.start && t < item.start + clipLength(item));
  if (!clip || clip.freeze != null) return timeline;
  const local = t - clip.start;
  const frame = round(sourceAt(clip, local));
  const still: Clip = { ...clip, id: ids[0], in: 0, out: seconds, speed: 1, freeze: frame, reverse: false, muted: true, fade_in: 0, fade_out: 0, enter: null, exit: null, transition_in: null,
    transform: { x: valueAt(clip.transform, 'x', local), y: valueAt(clip.transform, 'y', local), scale: valueAt(clip.transform, 'scale', local), opacity: valueAt(clip.transform, 'opacity', local), rotation: valueAt(clip.transform, 'rotation', local) } };
  const split = splitClip(timeline, t, ids[1]);
  const after = mainLayer(split).items.findIndex((item) => item.id === ids[1]);
  const index = after >= 0 ? after : mainLayer(split).items.findIndex((item) => item.id === clip.id);
  return insertClip(split, still, index);
}

export function splitClip(timeline: Timeline, t: number, newId: string): Timeline {
  const clips = mainLayer(timeline).items;
  const index = clips.findIndex((clip) => t > clip.start + MIN_CLIP_SECONDS / clip.speed && t < clip.start + clipLength(clip) - MIN_CLIP_SECONDS / clip.speed);
  if (index < 0) return timeline;
  const clip = clips[index];
  // A reversed clip shows its source's end first, so its first half is the source's later part.
  const local = t - clip.start;
  const cut = round(sourceAt(clip, local));
  const next = [...clips];
  const [before, after] = splitKeys(clip.transform, local);
  const [first, second]: Partial<Clip>[] = clip.reverse ? [{ in: cut }, { out: cut }] : [{ out: cut }, { in: cut }];
  if (clip.ramp) {
    // Each half keeps its part of the curve, at the speed that keeps every moment where it was.
    const share = local / clipLength(clip);
    const played = rampShare(clip.ramp, share) * (clip.out - clip.in);
    const [early, late] = splitRamp(clip.ramp, share);
    Object.assign(first, { ramp: early, speed: round(played / local) });
    Object.assign(second, { ramp: late, speed: round((clip.out - clip.in - played) / (clipLength(clip) - local)) });
  }
  next.splice(index, 1, { ...clip, ...first, transform: before, exit: null, fade_out: 0 }, { ...clip, ...second, id: newId, transform: after, enter: null, fade_in: 0, transition_in: null });
  return withClips(timeline, next);
}

/** Moves one edge of a clip. `seconds` is in source time, already limited to what the source allows. */
export function trimClip(timeline: Timeline, id: string, edge: 'in' | 'out', seconds: number, source?: SourceFacts): Timeline {
  const clips = mainLayer(timeline).items.map((clip) => {
    if (clip.id !== id) return clip;
    const end = source?.media_type === 'image' || clip.freeze != null ? MAX_PHOTO_SECONDS : source?.duration ?? clip.out;
    if (clip.reverse) {
      // Its start on the timeline shows the source's end, so each edge moves the other end of the source.
      const delta = seconds - (edge === 'in' ? clip.in : clip.out);
      if (edge === 'out') return { ...clip, in: round(Math.max(0, Math.min(clip.out - MIN_CLIP_SECONDS, clip.in - delta))) };
      const out = round(Math.min(end, Math.max(clip.in + MIN_CLIP_SECONDS, clip.out - delta)));
      return { ...clip, out, transform: shiftKeys(clip.transform, -(clip.out - out) / clip.speed) };
    }
    if (edge === 'in') {
      const next = round(Math.max(0, Math.min(seconds, clip.out - MIN_CLIP_SECONDS)));
      return { ...clip, in: next, transform: shiftKeys(clip.transform, -(next - clip.in) / clip.speed) };
    }
    return { ...clip, out: round(Math.min(end, Math.max(seconds, clip.in + MIN_CLIP_SECONDS))) };
  });
  return withClips(timeline, clips);
}

export function updateClip(timeline: Timeline, id: string, changes: Partial<Clip>): Timeline {
  const overlay = overlayHolding(timeline, id);
  if (overlay) return withItems(timeline, overlay, overlay.items.map((clip) => (clip.id === id ? { ...clip, ...changes } : clip)));
  return withClips(timeline, mainLayer(timeline).items.map((clip) => (clip.id === id ? { ...clip, ...changes } : clip)));
}

/**
 * Puts a title behind the person: a cut-out copy of the main clip under it goes on a layer just above the title.
 * The copy is silent and follows the main clip's timing; later edits to the main clip don't change it.
 */
export function putBehindPerson(timeline: Timeline, textId: string, ids: [string, string]): Timeline {
  return putInFront(timeline, textId, { cutout: 'remove', cutout_pick: null }, ids, 'Person');
}

/** Puts a title behind things in the scene, found automatically: a car, a bus, an animal. All of them at first; the copy's panel picks which. */
export function putBehindObject(timeline: Timeline, textId: string, ids: [string, string]): Timeline {
  return putInFront(timeline, textId, { cutout: 'remove', cutout_pick: { kind: 'objects', ids: null } }, ids, 'Object');
}

/**
 * Which cut-out copy a clip plays: 'remove' or 'blur' for every person, the chosen people or objects removed from
 * their background, such as 'people-0-2', or kept sharp over a blurred one, such as 'blur.people-0.strong'.
 */
export function cutoutToken(clip: Clip): string {
  const pick = clip.cutout ? clip.cutout_pick : null;
  const everyone = !pick || (pick.kind === 'people' && !pick.ids?.length);
  const who = everyone ? 'all' : `${pick.kind}-${pick.ids?.length ? [...pick.ids].sort((a, b) => a - b).join('-') : 'all'}`;
  if (clip.cutout === 'blur') {
    const amount = clip.blur_amount ?? 'medium';
    const pull = clip.focus_pull;
    if (pull) {
      const kind = pick?.kind ?? 'people';
      const to = !pull.to?.length ? (kind === 'people' ? 'all' : `${kind}-all`) : `${kind}-${[...pull.to].sort((a, b) => a - b).join('-')}`;
      return `blur.${who}.${amount}.${to}@${Math.round(pull.at * 1000)}+${Math.round(pull.length * 1000)}`;
    }
    return everyone && amount === 'medium' ? 'blur' : `blur.${who}.${amount}`;
  }
  return everyone ? clip.cutout ?? '' : who;
}

/** Puts a title behind part of the scene: a copy of the main clip under it, showing only `mask`, just above the title. */
export function putBehindShape(timeline: Timeline, textId: string, mask: ShapeMask, ids: [string, string]): Timeline {
  return putInFront(timeline, textId, { shape_mask: mask }, ids, 'In front');
}

function putInFront(timeline: Timeline, textId: string, changes: Partial<Clip>, ids: [string, string], name: string): Timeline {
  const found = findText(timeline, textId);
  const clip = found && mainLayer(timeline).items.find((item) => found.text.start >= item.start && found.text.start < item.start + clipLength(item));
  if (!found || !clip || timeline.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) return timeline;
  const copy: Clip = { ...clip, id: ids[0], ...changes, muted: true, clean_voice: false, enter: null, exit: null, transition_in: null, fade_in: 0, fade_out: 0 };
  const after = timeline.layers.indexOf(found.layer) + 1;
  return { ...timeline, layers: [...timeline.layers.slice(0, after), { id: ids[1], kind: 'video', name, items: [copy] }, ...timeline.layers.slice(after)] };
}

/** The focus pull's time for the moment `local` seconds into the clip: source seconds, or the reversed copy's own. */
export function focusAt(clip: Clip, local: number, sourceDuration?: number | null): number {
  const t = sourceAt(clip, local);
  return round(Math.max(0, clip.reverse && clip.freeze == null && sourceDuration ? sourceDuration - t : t));
}

/** Where in the clip a focus pull happens, in the clip's own seconds. */
export function focusLocal(clip: Clip, at: number, sourceDuration?: number | null): number {
  return localAt(clip, clip.reverse && clip.freeze == null && sourceDuration ? sourceDuration - at : at);
}

/**
 * A new picture or video behind a clip whose background is removed, filling the frame whatever its shape.
 * A main-track clip moves up to a layer of its own, at the same time, and the new background takes its place on the
 * main track, so nothing after it moves. A clip already above the main track gets the main clip under it replaced.
 * A video background shorter than the clip plays slower to cover it; a photo simply lasts as long.
 */
export function replaceBackground(timeline: Timeline, clipId: string, source: SourceFacts & { width: number; height: number }, ids: [string, string]): Timeline {
  const main = mainLayer(timeline);
  const onMain = main.items.find((item) => item.id === clipId);
  const above = onMain ? null : timeline.layers.flatMap((layer) => (layer.kind === 'video' && layer !== main ? layer.items : [])).find((item) => item.id === clipId);
  const person = onMain ?? above;
  if (!person) return timeline;
  const under = onMain ?? main.items.find((item) => person.start >= item.start - 1e-6 && person.start < item.start + clipLength(item));
  if (!under) return timeline;
  const length = clipLength(under);
  const fresh = newClip(source, ids[0]);
  const available = source.media_type === 'image' ? length : source.duration ?? length;
  const speed = available >= length ? 1 : Math.max(0.05, round(available / length));
  const background: Clip = { ...fresh, start: under.start, out: round(Math.min(available, length * speed)), speed, muted: true, transition_in: under.transition_in ?? null,
    transform: { ...fresh.transform, scale: round(fillScale(source, 0, timeline.format)) } };
  const replaced = withClips(timeline, main.items.map((item) => (item.id === under.id ? background : item)));
  if (!onMain) return replaced;
  if (timeline.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`Use up to ${MAX_VIDEO_LAYERS} video layers.`);
  const moved: Clip = { ...person, transition_in: null };
  const index = replaced.layers.findIndex((layer) => layer.id === main.id) + 1;
  return { ...replaced, layers: [...replaced.layers.slice(0, index), { id: ids[1], kind: 'video', name: 'Person', items: [moved] }, ...replaced.layers.slice(index)] };
}

/** A shape from points clicked along the top of the ground or a mountain: everything below the line, out to both edges. */
export function groundShape(points: [number, number][]): [number, number][] {
  const line = [...points].sort((a, b) => a[0] - b[0]);
  return [[0, line[0][1]], ...line, [1, line[line.length - 1][1]], [1, 1], [0, 1]];
}

/** The I and O keys: cut the clip's start or end at `local`. A ramped clip is split there, so the rest keeps its exact timing. */
export function trimAtPlayhead(timeline: Timeline, clip: Clip, edge: 'in' | 'out', local: number, newId: () => string, source?: SourceFacts): Timeline {
  if (clip.ramp) {
    const id = newId();
    const split = splitClip(timeline, clip.start + local, id);
    return split === timeline ? timeline : removeClip(split, edge === 'in' ? clip.id : id);
  }
  const into = clip.reverse ? clip.out - sourceAt(clip, local) : sourceAt(clip, local) - clip.in;
  return trimClip(timeline, clip.id, edge, clip.in + into, source);
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
  const sounds = trackLayers(timeline).flatMap((layer) => layer.items as TrackItem[]).filter((item) => item.id !== except).flatMap((item) => [item.start, item.start + itemLength(item)]);
  return [0, playhead, ...sounds, ...mainLayer(timeline).items.filter((clip) => clip.id !== except).flatMap((clip) => [clip.start, clip.start + clipLength(clip)])];
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

export const soundLength = (sound: Sound) => (sound.out - sound.in) / sound.speed;
const soundEnd = (sound: Sound) => sound.start + soundLength(sound);
const fits = (layer: AudioLayer, sound: Sound, ignore = sound.id) => layer.items.every((item) => item.id === ignore || soundEnd(item) <= sound.start + 1e-6 || soundEnd(sound) <= item.start + 1e-6);

function withSounds(timeline: Timeline, layer: AudioLayer, items: Sound[]): Timeline {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  return { ...timeline, layers: timeline.layers.map((entry) => entry.id === layer.id ? { ...layer, items: sorted } : entry) };
}

/** Sounds go on the first free audio track, and a new track is made when none is free. */
export function addSound(timeline: Timeline, sound: Sound, layerId: string): Timeline {
  const free = audioLayers(timeline).find((layer) => fits(layer, sound));
  if (free) return withSounds(timeline, free, [...free.items, sound]);
  return { ...timeline, layers: [...timeline.layers, { id: layerId, kind: 'audio', name: 'Sound', items: [sound] }] };
}

export function removeSound(timeline: Timeline, id: string): Timeline {
  const found = findSound(timeline, id);
  if (!found) return timeline;
  const items = found.layer.items.filter((item) => item.id !== id);
  return items.length ? withSounds(timeline, found.layer, items) : { ...timeline, layers: timeline.layers.filter((layer) => layer.id !== found.layer.id) };
}

export function updateSound(timeline: Timeline, id: string, changes: Partial<Sound>): Timeline {
  const found = findSound(timeline, id);
  return found ? withSounds(timeline, found.layer, found.layer.items.map((item) => item.id === id ? { ...item, ...changes } : item)) : timeline;
}

export type LayerChanges = { hidden?: boolean; locked?: boolean; muted?: boolean; blend?: BlendMode };

export function updateLayer(timeline: Timeline, id: string, changes: LayerChanges): Timeline {
  return { ...timeline, layers: timeline.layers.map((layer) => (layer.id === id ? { ...layer, ...changes } as Timeline['layers'][number] : layer)) };
}

export const layerOf = (timeline: Timeline, itemId: string | null) => timeline.layers.find((layer) => (layer.items as { id: string }[]).some((item) => item.id === itemId));
export const isLocked = (timeline: Timeline, itemId: string | null) => Boolean(layerOf(timeline, itemId)?.locked);

/** Overlays stack in layer order. Forward means nearer the viewer. The main track stays at the back. */
export function reorderLayer(timeline: Timeline, id: string, direction: 'forward' | 'back'): Timeline {
  const overlays = overlayLayers(timeline);
  const index = overlays.findIndex((layer) => layer.id === id);
  const other = overlays[index + (direction === 'forward' ? 1 : -1)];
  if (index < 0 || !other) return timeline;
  return { ...timeline, layers: timeline.layers.map((layer) => (layer.id === id ? other : layer.id === other.id ? overlays[index] : layer)) };
}

const itemEnd = (item: TrackItem) => item.start + itemLength(item);

function withItems(timeline: Timeline, layer: TrackLayer, items: TrackItem[]): Timeline {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  return { ...timeline, layers: timeline.layers.map((entry) => entry.id === layer.id ? { ...layer, items: sorted } as TrackLayer : entry) };
}

/** Moves in time, stopping at neighbours. An item changes track only when it fits there, and text stays with text. */
export function moveItem(timeline: Timeline, id: string, start: number, layerId?: string): Timeline {
  const layers = trackLayers(timeline);
  const from = layers.find((layer) => (layer.items as TrackItem[]).some((item) => item.id === id));
  if (!from) return timeline;
  const item = (from.items as TrackItem[]).find((entry) => entry.id === id)!;
  const wanted = layers.find((layer) => layer.id === layerId);
  const target = wanted && wanted.kind === from.kind ? wanted : from;
  const others = (target.items as TrackItem[]).filter((entry) => entry.id !== id).sort((a, b) => a.start - b.start);
  const length = itemLength(item);
  let at = Math.max(0, round(start));
  for (const other of others) {
    if (at < itemEnd(other) && at + length > other.start) at = at + length / 2 < other.start + itemLength(other) / 2 ? round(other.start - length) : round(itemEnd(other));
  }
  const moved = { ...item, start: at };
  if (at < 0 || others.some((other) => other.start < at + length - 1e-6 && itemEnd(other) > at + 1e-6)) return timeline;
  if (target.id === from.id) return withItems(timeline, from, (from.items as TrackItem[]).map((entry) => entry.id === id ? moved : entry));
  const without = withItems(timeline, from, (from.items as TrackItem[]).filter((entry) => entry.id !== id));
  return withItems(without, target, [...target.items as TrackItem[], moved]);
}

export const moveSound = moveItem;

const timedItem = (timeline: Timeline, id: string): { item: Sound | Clip; layer: AudioLayer | VideoLayer } | null => {
  for (const layer of [...overlayLayers(timeline), ...audioLayers(timeline)]) {
    const item = (layer.items as (Sound | Clip)[]).find((entry) => entry.id === id);
    if (item) return { item, layer };
  }
  return null;
};

const changeItem = (timeline: Timeline, id: string, changes: Partial<Sound> & Partial<Clip>) => {
  const found = timedItem(timeline, id)!;
  return withItems(timeline, found.layer, (found.layer.items as TrackItem[]).map((item) => (item.id === id ? { ...item, ...changes } as TrackItem : item)));
};

/** `seconds` is the wanted source time of that edge. Trimming the start keeps the rest of the item in place. Works on sounds and overlays. */
export function trimSound(timeline: Timeline, id: string, edge: 'in' | 'out', seconds: number, limit?: number): Timeline {
  const found = timedItem(timeline, id);
  if (!found) return timeline;
  const { item, layer } = found;
  const others = (layer.items as TrackItem[]).filter((entry) => entry.id !== id);
  const end = item.start + itemLength(item);
  if (edge === 'in') {
    const earliest = Math.max(0, item.in - (item.start - others.filter((entry) => entry.start < item.start).reduce((last, entry) => Math.max(last, itemEnd(entry)), 0)) * item.speed);
    const next = round(Math.min(Math.max(seconds, earliest), item.out - MIN_CLIP_SECONDS * item.speed));
    const shift = (next - item.in) / item.speed;
    return changeItem(timeline, id, { in: next, start: round(item.start + shift), ...(isClip(item) ? { transform: shiftKeys(item.transform, -shift) } : {}) });
  }
  const after = others.filter((entry) => entry.start >= end - 1e-6).reduce((first, entry) => Math.min(first, entry.start), Infinity);
  const longest = Math.min(limit ?? (isClip(item) ? Infinity : item.source_length ?? Infinity), item.in + (after - item.start) * item.speed);
  return changeItem(timeline, id, { out: round(Math.max(item.in + MIN_CLIP_SECONDS * item.speed, Math.min(seconds, longest))) });
}

/** Works on sounds and overlays. */
export function splitSound(timeline: Timeline, id: string, t: number, newId: string): Timeline {
  const found = timedItem(timeline, id);
  if (!found) return timeline;
  const { item, layer } = found;
  const middle = round(item.in + (t - item.start) * item.speed);
  if (t - item.start < MIN_CLIP_SECONDS || itemEnd(item) - t < MIN_CLIP_SECONDS) return timeline;
  const clipped = isClip(item) ? splitKeys(item.transform, t - item.start) : null;
  const first = { ...item, out: middle, fade_out: 0, ...(clipped ? { transform: clipped[0], exit: null } : {}) };
  const second = { ...item, id: newId, start: round(t), in: middle, fade_in: 0, ...(clipped ? { transform: clipped[1], enter: null } : {}) };
  return withItems(timeline, layer, (layer.items as TrackItem[]).flatMap((entry) => entry.id === id ? [first, second] as TrackItem[] : [entry]));
}

/** The picture stays. Its sound becomes a separate item, in the same place, that can then move on its own. */
export function detachAudio(timeline: Timeline, clipId: string, soundId: string, layerId: string, name: string, sourceLength?: number): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip || clip.muted) return timeline;
  const sound: Sound = { id: soundId, media_id: clip.media_id, start: clip.start, in: clip.in, out: clip.out, speed: clip.speed, volume: clip.volume, muted: false,
    fade_in: clip.fade_in, fade_out: clip.fade_out, duck: false, name, source_length: sourceLength };
  return addSound(updateClip(timeline, clipId, { muted: true, fade_in: 0, fade_out: 0 }), sound, layerId);
}

export function fadeGain(item: { fade_in: number; fade_out: number }, into: number, length: number): number {
  const shrink = Math.max(1, (item.fade_in + item.fade_out) / length);
  const fadeIn = item.fade_in / shrink; const fadeOut = item.fade_out / shrink;
  return Math.max(0, Math.min(1, fadeIn ? into / fadeIn : 1, fadeOut ? (length - into) / fadeOut : 1));
}

export function addText(timeline: Timeline, text: TextItem, layerId: string): Timeline {
  const free = textLayers(timeline).find((layer) => layer.items.every((item) => item.start + item.length <= text.start + 1e-6 || text.start + text.length <= item.start + 1e-6));
  if (free) return withItems(timeline, free, [...free.items, text]);
  return { ...timeline, layers: [...timeline.layers, { id: layerId, kind: 'text', name: 'Text', items: [text] }] };
}

export function removeText(timeline: Timeline, id: string): Timeline {
  const found = findText(timeline, id);
  if (!found) return timeline;
  const items = found.layer.items.filter((item) => item.id !== id);
  return items.length ? withItems(timeline, found.layer, items) : { ...timeline, layers: timeline.layers.filter((layer) => layer.id !== found.layer.id) };
}

export function updateText(timeline: Timeline, id: string, changes: Partial<TextItem>): Timeline {
  const found = findText(timeline, id);
  return found ? withItems(timeline, found.layer, found.layer.items.map((item) => item.id === id ? { ...item, ...changes } : item)) : timeline;
}

/** `at` is the wanted timeline time of that edge. Works on text and blur boxes. */
export function trimText(timeline: Timeline, id: string, edge: 'in' | 'out', at: number): Timeline {
  const blur = findBlur(timeline, id);
  const caption = findCaption(timeline, id);
  const found: { text: TextItem | BlurBox | Caption; layer: TextLayer | BlurLayer | CaptionLayer } | null = findText(timeline, id) ?? (blur && { text: blur.blur, layer: blur.layer }) ?? (caption && { text: caption.caption, layer: caption.layer });
  if (!found) return timeline;
  const { text, layer } = found;
  const set = (changes: { start?: number; length: number }) => withItems(timeline, layer, (layer.items as TrackItem[]).map((item) => (item.id === id ? { ...item, ...changes } as TrackItem : item)));
  const others = layer.items.filter((item) => item.id !== id);
  const end = text.start + text.length;
  if (edge === 'in') {
    const earliest = others.filter((item) => item.start < text.start).reduce((last, item) => Math.max(last, item.start + item.length), 0);
    const start = round(Math.min(Math.max(at, earliest), end - MIN_CLIP_SECONDS));
    const shift = start - text.start;
    return set({ start, length: round(end - start), ...('transform' in text && text.transform ? { transform: shiftKeys(text.transform, -shift) } : {}), ...('words' in text ? { words: keepWords(text.words, shift, end - start) } : {}) });
  }
  const after = others.filter((item) => item.start >= end - 1e-6).reduce((first, item) => Math.min(first, item.start), Infinity);
  const length = round(Math.max(text.start + MIN_CLIP_SECONDS, Math.min(at, after)) - text.start);
  return set({ length, ...('words' in text ? { words: keepWords(text.words, 0, length) } : {}) });
}

/** A caption's words after its start moves by `shift`: each stays on its moment, and none falls outside. */
function keepWords(words: CaptionWord[], shift: number, length: number): CaptionWord[] {
  const kept = words.map((word) => ({ ...word, s: round(Math.max(0, word.s - shift)) }));
  return kept.map((word) => ({ ...word, s: Math.min(word.s, round(length - MIN_CLIP_SECONDS / 2)) }));
}

export const BLUR_SECONDS = 3;
export const DEFAULT_BLUR: Omit<BlurBox, 'id' | 'start' | 'length'> = { style: 'blur', shape: 'oval', amount: 0.6, width: 0.2, height: 0.2, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 } };

/** Above every video layer and below text, so titles stay sharp. */
export function addBlur(timeline: Timeline, blur: BlurBox, layerId: string): Timeline {
  const free = blurLayers(timeline).find((layer) => layer.items.every((item) => item.start + item.length <= blur.start + 1e-6 || blur.start + blur.length <= item.start + 1e-6));
  if (free) return withItems(timeline, free, [...free.items, blur]);
  const after = timeline.layers.reduce((last, layer, index) => (layer.kind === 'video' || layer.kind === 'blur' ? index : last), 0) + 1;
  return { ...timeline, layers: [...timeline.layers.slice(0, after), { id: layerId, kind: 'blur', name: 'Blur', items: [blur] }, ...timeline.layers.slice(after)] };
}

export function updateBlur(timeline: Timeline, id: string, changes: Partial<BlurBox>): Timeline {
  const found = findBlur(timeline, id);
  return found ? withItems(timeline, found.layer, found.layer.items.map((item) => (item.id === id ? { ...item, ...changes } : item))) : timeline;
}

export function removeBlur(timeline: Timeline, id: string): Timeline {
  const found = findBlur(timeline, id);
  if (!found) return timeline;
  const items = found.layer.items.filter((item) => item.id !== id);
  return items.length ? withItems(timeline, found.layer, items) : { ...timeline, layers: timeline.layers.filter((layer) => layer.id !== found.layer.id) };
}

/** Half the frames of the transition opening `clip`, or 0. Matches transition_frames in timeline_service.py. */
export function transitionHalf(before: Clip, clip: Clip, fps: number): number {
  if (!clip.transition_in) return 0;
  const frames = (item: Clip) => Math.max(1, Math.round(clipLength(item) * fps));
  if (Math.round(before.start * fps) + frames(before) !== Math.round(clip.start * fps)) return 0;
  return Math.min(Math.round((clip.transition_in.duration * fps) / 2), Math.floor(frames(before) / 2), Math.floor(frames(clip) / 2));
}

export const MAX_VIDEO_LAYERS = 6;
export const OVERLAY_SCALE = 0.3;

/** On top of the main track, at its own time and place. Text stays above it. */
export function addOverlay(timeline: Timeline, clip: Clip, layerId: string): Timeline {
  const fits = (layer: VideoLayer) => layer.items.every((item) => item.start + clipLength(item) <= clip.start + 1e-6 || clip.start + clipLength(clip) <= item.start + 1e-6);
  const free = overlayLayers(timeline).find(fits);
  if (free) return withItems(timeline, free, [...free.items, clip]);
  if (timeline.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`Use up to ${MAX_VIDEO_LAYERS} video layers.`);
  const after = timeline.layers.reduce((last, layer, index) => (layer.kind === 'video' ? index : last), 0) + 1;
  return { ...timeline, layers: [...timeline.layers.slice(0, after), { id: layerId, kind: 'video', name: 'Overlay', items: [clip] }, ...timeline.layers.slice(after)] };
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const CORNER_MARGIN = 0.03;

/** Where a picture-in-picture goes: tucked into a corner, the same margin from both edges. */
export function cornerPlacement(source: { width: number; height: number }, rotation: number, format: Format, scale: number, corner: Corner) {
  const fitted = fittedSize(source, rotation, format);
  const margin = CORNER_MARGIN * Math.min(format.width, format.height);
  const halfX = (fitted.width * scale) / 2 + margin; const halfY = (fitted.height * scale) / 2 + margin;
  return { x: (corner.endsWith('left') ? halfX : format.width - halfX) / format.width, y: (corner.startsWith('top') ? halfY : format.height - halfY) / format.height };
}

/** A copy right after the original, in the same layer when it fits. */
export function duplicateItem(timeline: Timeline, id: string, newId: string, layerId: string): Timeline {
  const main = mainLayer(timeline);
  const index = main.items.findIndex((clip) => clip.id === id);
  if (index >= 0) return insertClip(timeline, { ...main.items[index], id: newId, transition_in: null }, index + 1);
  const clip = findClip(timeline, id);
  if (clip) return addOverlay(timeline, { ...clip, id: newId, start: round(clip.start + clipLength(clip)) }, layerId);
  const sound = findSound(timeline, id)?.sound;
  if (sound) return addSound(timeline, { ...sound, id: newId, start: round(sound.start + soundLength(sound)) }, layerId);
  const blur = findBlur(timeline, id)?.blur;
  if (blur) return addBlur(timeline, { ...blur, id: newId, start: round(blur.start + blur.length) }, layerId);
  const text = findText(timeline, id)?.text;
  return text ? addText(timeline, { ...text, id: newId, start: round(text.start + text.length) }, layerId) : timeline;
}

/** Takes every use of a file off the timeline. The file itself stays in Media. */
export function removeMedia(timeline: Timeline, mediaId: number): Timeline {
  const main = mainLayer(timeline);
  const cleared = withClips(timeline, main.items.filter((clip) => clip.media_id !== mediaId));
  const layers = cleared.layers.flatMap((layer) => {
    if (layer.id === main.id || layer.kind === 'text' || layer.kind === 'blur' || layer.kind === 'captions') return [layer];
    const items = (layer.items as (Clip | Sound)[]).filter((item) => item.media_id !== mediaId);
    return items.length ? [{ ...layer, items } as Timeline['layers'][number]] : [];
  });
  return { ...cleared, layers };
}

/** Changes speed. Items on free tracks stop at their neighbour, and clips keep their motion on the same footage. */
export function setSpeed(timeline: Timeline, id: string, speed: number): Timeline {
  const free = timedItem(timeline, id);
  const clip = findClip(timeline, id);
  const item = free?.item ?? clip;
  if (!item) return timeline;
  let next = speed;
  if (free) {
    const after = (free.layer.items as TrackItem[]).filter((entry) => entry.id !== id && entry.start >= item.start).reduce((first, entry) => Math.min(first, entry.start), Infinity);
    if (Number.isFinite(after)) next = Math.max(next, (item.out - item.in) / (after - item.start));
  }
  next = Math.round(next * 1000) / 1000;
  const changes = { speed: next, ...(clip ? { transform: scaleKeys(clip.transform, item.speed / next) } : {}) };
  return free ? changeItem(timeline, id, changes) : updateClip(timeline, id, changes);
}
