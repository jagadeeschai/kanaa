/**
 * Drag and drop from the side panel onto the timeline.
 * A tile (media, look, transition, title or music track) is dragged with a small JSON payload;
 * the timeline works out where it landed and `applyDrop` makes the change in one Undo step.
 * Kept free of React and the DOM so it can be tested on its own.
 */
import type { LookName, TransitionKind } from './animation.ts';
import { clipLength, insertClip, mainLayer, overlayLayers, updateClip, type Clip, type Timeline } from './model.ts';

export const DRAG_TYPE = 'application/x-kanaa';
export const TRANSITION_SECONDS = 0.6;

export type DragPayload =
  | { kind: 'media'; id: number }
  | { kind: 'look'; look: LookName }
  | { kind: 'transition'; transition: TransitionKind }
  | { kind: 'title'; template: string }
  | { kind: 'track'; track: string };

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
    if (value?.kind === 'title' && typeof value.template === 'string') return value;
    if (value?.kind === 'track' && typeof value.track === 'string') return value;
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
    case 'title': return 'Add a title here';
    case 'track': return 'Add music here';
  }
}

/** Applies a look or transition dropped on a clip. Media, titles and music need the editor (ids, uploads), so it handles those. */
export function applyClipDrop(timeline: Timeline, payload: DragPayload, clipId: string): Timeline {
  if (payload.kind === 'look') return updateClip(timeline, clipId, { look: payload.look });
  if (payload.kind === 'transition') {
    if (!isMainAfterFirst(timeline, clipId)) return timeline;
    const clip = findAny(timeline, clipId)!;
    const room = Math.max(0.2, Math.min(TRANSITION_SECONDS, clipLength(clip) / 2));
    return updateClip(timeline, clipId, { transition_in: { kind: payload.transition, duration: Math.round(room * 10) / 10 } });
  }
  return timeline;
}

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
