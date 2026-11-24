/** Cinematic lens on the timeline: the clip plays a made copy of its part (lens_service.py) with real depth of field;
 *  Remove lens puts the original back, exactly as it was. */
import { findClip, updateClip, type Clip, type Timeline } from './model.ts';

export type LensPreset = 'portrait' | 'dreamy' | 'rack-out' | 'rack-in';
export type LensStrength = 'soft' | 'medium' | 'strong';
export const LENS_PRESETS: { id: LensPreset; label: string; about: string }[] = [
  { id: 'portrait', label: 'Portrait', about: 'The person stays sharp; the background melts away' },
  { id: 'dreamy', label: 'Dreamy', about: 'A stronger, glowing blur for a soft, romantic look' },
  { id: 'rack-out', label: 'Focus: near → far', about: 'The focus glides from the people to the view behind them' },
  { id: 'rack-in', label: 'Focus: far → near', about: 'The focus glides from the view to the people' },
];

/** What the lens needs from a clip: its source and the part it plays. */
export function lensPart(clip: Clip) {
  const original = clip.lens;
  return original ? { media: original.original_media_id, start: original.original_in, end: original.original_out } : { media: clip.media_id, start: clip.in, end: clip.out };
}

export function cannotLens(clip: Clip): string | null {
  if (clip.reverse || clip.ramp || clip.freeze != null) return 'The cinematic lens works on a clip that plays normally (not reversed, ramped or frozen).';
  if (clip.slowmo) return 'Set the clip back to normal speed first, then add the lens (and slow it down again after).';
  if (clip.atmosphere) return 'Remove the atmosphere first, add the lens, then the atmosphere again.';
  if (clip.new_sky) return 'Remove the new sky first, add the lens, then the sky again.';
  return null;
}

export function applyLens(timeline: Timeline, clipId: string, made: number, preset: LensPreset, strength: LensStrength): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip) return timeline;
  const part = lensPart(clip);
  return updateClip(timeline, clipId, { media_id: made, in: 0, out: Math.round((part.end - part.start) * 1000) / 1000,
    lens: { original_media_id: part.media, original_in: part.start, original_out: part.end, preset, strength } });
}

export function removeLens(timeline: Timeline, clipId: string): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip?.lens) return timeline;
  return updateClip(timeline, clipId, { media_id: clip.lens.original_media_id, in: clip.lens.original_in, out: clip.lens.original_out, lens: null });
}
