/**
 * Drag and drop from the side panel onto the timeline.
 * A tile (media, look, transition, title or music track) is dragged with a small JSON payload;
 * the timeline works out where it landed and `applyDrop` makes the change in one Undo step.
 * Kept free of React and the DOM so it can be tested on its own.
 */
import type { LookName, TransitionKind } from './animation.ts';
import { DEFAULT_LENS_SURFACE, DEFAULT_OLD_FILM, DEFAULT_SIGNAL_DAMAGE, clipLength, insertClip, mainLayer, MAX_VIDEO_LAYERS, overlayLayers, updateClip, type Clip, type Timeline, type VideoLayer } from './model.ts';

export const DRAG_TYPE = 'application/x-kanaa';
export const TRANSITION_SECONDS = 0.6;
export type ClipEffectPreset = 'old-film' | 'glitch' | 'vhs' | 'raindrops' | 'lens-dirt';

export type DragPayload =
  | { kind: 'media'; id: number }
  | { kind: 'look'; look: LookName }
  | { kind: 'transition'; transition: TransitionKind }
  | { kind: 'clip_effect'; effect: ClipEffectPreset }
  | { kind: 'title'; template: string }
  | { kind: 'track'; track: string }
  | { kind: 'effect'; effect: string };

/** Where on the timeline something was dropped. `clipId` is the clip under the pointer, if any. */
export type DropTarget = { zone: 'main' | 'above'; time: number; clipId: string | null };

export function encodePayload(payload: DragPayload): string { return JSON.stringify(payload); }

export function decodePayload(raw: string | null | undefined): DragPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DragPayload;
    if (value?.kind === 'media' && Number.isInteger(value.id)) return value;
    if (value?.kind === 'look' && typeof value.look === 'string') return value;
    if (value?.kind === 'transition' && typeof value.transition === 'string') return value;
    if (value?.kind === 'clip_effect' && ['old-film', 'glitch', 'vhs', 'raindrops', 'lens-dirt'].includes(value.effect)) return value;
    if (value?.kind === 'title' && typeof value.template === 'string') return value;
    if (value?.kind === 'track' && typeof value.track === 'string') return value;
    if (value?.kind === 'effect' && typeof value.effect === 'string') return value;
  } catch { /* Not ours: a file or text from elsewhere. */ }
  return null;
}

/** Where a clip dropped at `time` goes in the magnetic main track: before the first clip whose middle is later. */
export function insertIndex(timeline: Timeline, time: number): number {
  return mainLayer(timeline).items.filter((clip) => clip.start + clipLength(clip) / 2 < time).length;
}

/** The clip (main track first, then overlays) playing at `time`. */
export function clipAt(timeline: Timeline, time: number, zone: DropTarget['zone']): Clip | null {
  const layers = zone === 'main' ? [mainLayer(timeline)] : overlayLayers(timeline);
  for (const layer of layers) for (const clip of layer.items) if (time >= clip.start && time < clip.start + clipLength(clip)) return clip;
  return null;
}

/** Puts a new main-track clip where it was dropped. */
export function dropClip(timeline: Timeline, clip: Clip, time: number): Timeline {
  return insertClip(timeline, clip, insertIndex(timeline, time));
}

/** What a payload would do at a target, as a short message for the drop hint, or null if it can't go there. */
export function dropHint(timeline: Timeline, payload: DragPayload, target: DropTarget): string | null {
  const clip = target.clipId ? findAny(timeline, target.clipId) : null;
  switch (payload.kind) {
    case 'media': return target.zone === 'main' ? (mainLayer(timeline).locked ? null : 'Insert here') : 'Add on top';
    case 'look': return clip ? 'Colour this clip' : null;
    case 'transition': return clip && isMainAfterFirst(timeline, clip.id) ? 'Transition into this clip' : null;
    case 'clip_effect': return clip ? `Apply ${clipEffectLabel(payload.effect)}` : null;
    case 'title': return 'Add a title here';
    case 'track': return 'Add music here';
    case 'effect': return 'Add effect here';
  }
}

/** Applies a look or transition dropped on a clip. Media, titles and music need the editor (ids, uploads), so it handles those. */
export function applyClipDrop(timeline: Timeline, payload: DragPayload, clipId: string): Timeline {
  if (payload.kind === 'look') return updateClip(timeline, clipId, { look: payload.look });
  if (payload.kind === 'clip_effect') {
    if (payload.effect === 'old-film') return updateClip(timeline, clipId, { old_film: { ...DEFAULT_OLD_FILM } });
    if (payload.effect === 'glitch' || payload.effect === 'vhs') return updateClip(timeline, clipId, { signal_damage: { ...DEFAULT_SIGNAL_DAMAGE, mode: payload.effect } });
    return updateClip(timeline, clipId, { lens_surface: { ...DEFAULT_LENS_SURFACE, mode: payload.effect === 'lens-dirt' ? 'dirt' : 'raindrops' } });
  }
  if (payload.kind === 'transition') {
    if (!isMainAfterFirst(timeline, clipId)) return timeline;
    const clip = findAny(timeline, clipId)!;
    const room = Math.max(0.2, Math.min(TRANSITION_SECONDS, clipLength(clip) / 2));
    return updateClip(timeline, clipId, { transition_in: { kind: payload.transition, duration: Math.round(room * 10) / 10 } });
  }
  return timeline;
}

const clipEffectLabel = (effect: ClipEffectPreset) => ({ 'old-film': 'Old film', glitch: 'Digital glitch', vhs: 'VHS tape', raindrops: 'Raindrops', 'lens-dirt': 'Lens dirt' })[effect];

function findAny(timeline: Timeline, id: string): Clip | null {
  for (const layer of [mainLayer(timeline), ...overlayLayers(timeline)]) { const found = layer.items.find((clip) => clip.id === id); if (found) return found; }
  return null;
}

/** Transitions blend from the clip before, so only main-track clips after the first take one. */
function isMainAfterFirst(timeline: Timeline, id: string): boolean {
  const ordered = [...mainLayer(timeline).items].sort((a, b) => a.start - b.start);
  return ordered.findIndex((clip) => clip.id === id) > 0;
}

/** Browsers hide drag data until the drop, so the payload being dragged is kept here for the hover hint. */
let active: DragPayload | null = null;
export const activeDrag = () => active;
export const setActiveDrag = (payload: DragPayload | null) => { active = payload; };

export const EFFECT_LAYER = 'Effects';

/**
 * A special effect (drawn on black by backend effect_service.py) goes on its own layer with the Screen blend,
 * above the other video, so its black disappears and only its light shows. Effects share that layer when they don't overlap.
 */
export function placeEffect(timeline: Timeline, clip: Clip, layerId: string): Timeline {
  const fits = (layer: VideoLayer) => layer.items.every((item) => item.start + clipLength(item) <= clip.start + 1e-6 || clip.start + clipLength(clip) <= item.start + 1e-6);
  const free = overlayLayers(timeline).find((layer) => layer.blend === 'screen' && layer.name === EFFECT_LAYER && !layer.locked && fits(layer));
  if (free) return { ...timeline, layers: timeline.layers.map((layer) => (layer === free ? { ...free, items: [...free.items, clip] } : layer)) };
  if (timeline.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`Use up to ${MAX_VIDEO_LAYERS} video layers. Delete an overlay, or move this effect to a time with no other effect.`);
  const after = timeline.layers.reduce((last, layer, index) => (layer.kind === 'video' ? index : last), 0) + 1;
  const layer: VideoLayer = { id: layerId, kind: 'video', name: EFFECT_LAYER, blend: 'screen', items: [clip] };
  return { ...timeline, layers: [...timeline.layers.slice(0, after), layer, ...timeline.layers.slice(after)] };
}
