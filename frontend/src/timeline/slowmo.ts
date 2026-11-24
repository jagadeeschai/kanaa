/** Smooth slow motion on the timeline: the clip plays a made, slowed copy of its part (slowmo_service.py), with new
 *  frames between its own; Normal speed puts the original back exactly. The clip gets longer, as slow motion does. */
import { findClip, updateClip, type Clip, type Timeline } from './model.ts';

export type SlowFactor = 2 | 4 | 8;
export const SLOW_FACTORS: { id: SlowFactor; label: string; about: string }[] = [
  { id: 2, label: '½ speed', about: 'Gently slower' }, { id: 4, label: '¼ speed', about: 'Dramatic slow motion' }, { id: 8, label: '⅛ speed', about: 'Very slow; best on short moments' },
];

export function slowPart(clip: Clip) {
  return clip.slowmo ? { media: clip.slowmo.original_media_id, start: clip.slowmo.original_in, end: clip.slowmo.original_out } : { media: clip.media_id, start: clip.in, end: clip.out };
}

export function cannotSlow(clip: Clip): string | null {
  if (clip.reverse || clip.ramp || clip.freeze != null) return 'Smooth slow motion works on a clip that plays normally (not reversed, ramped or frozen).';
  if (clip.atmosphere) return 'Remove the atmosphere first, slow the clip down, then add the atmosphere again.';
  if (clip.lens) return 'Remove the cinematic lens first, slow the clip down, then add the lens again.';
  if (clip.speed !== 1) return 'Set the clip to normal speed first; smooth slow motion makes its own.';
  return null;
}

export function applySlow(timeline: Timeline, clipId: string, made: number, factor: SlowFactor): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip) return timeline;
  const part = slowPart(clip);
  return updateClip(timeline, clipId, { media_id: made, in: 0, out: Math.round((part.end - part.start) * factor * 1000) / 1000, muted: true,
    slowmo: { original_media_id: part.media, original_in: part.start, original_out: part.end, factor } });
}

export function removeSlow(timeline: Timeline, clipId: string): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip?.slowmo) return timeline;
  return updateClip(timeline, clipId, { media_id: clip.slowmo.original_media_id, in: clip.slowmo.original_in, out: clip.slowmo.original_out, muted: false, slowmo: null });
}
