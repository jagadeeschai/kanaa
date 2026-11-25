/** Time freeze in 3D on the timeline: the moment at the playhead is held, and the held part plays a made video of the
 *  camera moving around it (time_freeze_service.py). Changing the move swaps the video; ⌘Z undoes it all. */
import { clipLength, findClip, freezeFrame, mainLayer, updateClip, type Clip, type Timeline } from './model.ts';
import { sourceAt } from './ramp.ts';

const round = (value: number) => Math.round(value * 1000) / 1000;

export type FreezeMove = 'orbit-left' | 'orbit-right' | 'push-in' | 'rise';
export const FREEZE_MOVES: { id: FreezeMove; label: string; about: string }[] = [
  { id: 'orbit-right', label: 'Orbit right', about: 'The camera circles to the right around the frozen people' },
  { id: 'orbit-left', label: 'Orbit left', about: 'The camera circles to the left around the frozen people' },
  { id: 'push-in', label: 'Push in', about: 'The camera glides in towards the frozen moment' },
  { id: 'rise', label: 'Rise', about: 'The camera lifts up over the frozen scene' },
];
export const FREEZE_LENGTHS = [2, 3, 4] as const;

/** The clip at `t` and the moment of its recording there, if it can be frozen. */
export function freezePoint(timeline: Timeline, t: number): { clip: Clip; at: number } | null {
  const clip = mainLayer(timeline).items.find((item) => t >= item.start && t < item.start + clipLength(item));
  if (!clip || clip.freeze != null || clip.freeze3d) return null;
  return { clip, at: round(sourceAt(clip, t - clip.start)) };
}

export function cannotFreeze3d(clip: Clip | null): string | null {
  if (!clip) return 'Move the playhead onto a video clip on the main track.';
  if (clip.freeze != null) return 'This clip is already a still frame.';
  return null;
}

/** Holds the moment at `t` for `seconds`, playing the made video `made` there. */
export function addFreeze3d(timeline: Timeline, t: number, made: number, move: FreezeMove, seconds: number, ids: [string, string], tune: Record<string, number> = {}): Timeline {
  const point = freezePoint(timeline, t);
  if (!point) return timeline;
  const held = freezeFrame(timeline, t, ids, seconds);
  if (held === timeline) return timeline;
  return updateClip(held, ids[0], { media_id: made, freeze: null, in: 0, out: seconds, freeze3d: { original_media_id: point.clip.media_id, at: point.at, move, ...(Object.keys(tune).length ? { tune } : {}) } });
}

/** A different move for a time freeze already made: its video swapped, its place and length kept. */
export function changeFreeze3d(timeline: Timeline, clipId: string, made: number, move: FreezeMove, tune: Record<string, number> = {}): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip?.freeze3d) return timeline;
  return updateClip(timeline, clipId, { media_id: made, freeze3d: { ...clip.freeze3d, move, tune: Object.keys(tune).length ? tune : null } });
}
