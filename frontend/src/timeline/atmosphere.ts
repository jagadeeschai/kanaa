/** Atmosphere from depth on the timeline: the clip plays a made copy of its part with mist, haze or fog laid in by
 *  distance (atmosphere_service.py); Remove atmosphere puts the original back, exactly as it was. */
import { findClip, updateClip, type Clip, type Timeline } from './model.ts';

export type AtmospherePreset = 'mist' | 'sunset' | 'rain' | 'low-fog';
export type AtmosphereStrength = 'light' | 'medium' | 'heavy';
export const ATMOSPHERE_PRESETS: { id: AtmospherePreset; label: string; about: string }[] = [
  { id: 'mist', label: 'Morning mist', about: 'Soft white mist fills the distance; the people stay clear' },
  { id: 'sunset', label: 'Dusty sunset', about: 'Warm golden haze in the far air, like dust in evening light' },
  { id: 'rain', label: 'Rain haze', about: 'Cool grey haze and muted colour, like a rainy day' },
  { id: 'low-fog', label: 'Low fog', about: 'Fog lying low over the far ground; the sky stays clear' },
];

/** What atmosphere needs from a clip: its source and the part it plays (the original when it already has air). */
export function atmospherePart(clip: Clip) {
  const original = clip.atmosphere;
  return original ? { media: original.original_media_id, start: original.original_in, end: original.original_out } : { media: clip.media_id, start: clip.in, end: clip.out };
}

export function cannotAtmosphere(clip: Clip): string | null {
  if (clip.reverse || clip.ramp || clip.freeze != null) return 'Atmosphere works on a clip that plays normally (not reversed, ramped or frozen).';
  if (clip.new_sky) return 'Remove the new sky first, add the atmosphere, then the sky again.';
  if (clip.lens) return 'Remove the cinematic lens first, add the atmosphere, then the lens again.';
  if (clip.slowmo) return 'Set the clip back to normal speed first, add the atmosphere, then slow it down again.';
  return null;
}

export function applyAtmosphere(timeline: Timeline, clipId: string, made: number, preset: AtmospherePreset, strength: AtmosphereStrength): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip) return timeline;
  const part = atmospherePart(clip);
  return updateClip(timeline, clipId, { media_id: made, in: 0, out: Math.round((part.end - part.start) * 1000) / 1000,
    atmosphere: { original_media_id: part.media, original_in: part.start, original_out: part.end, preset, strength } });
}

export function removeAtmosphere(timeline: Timeline, clipId: string): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip?.atmosphere) return timeline;
  return updateClip(timeline, clipId, { media_id: clip.atmosphere.original_media_id, in: clip.atmosphere.original_in, out: clip.atmosphere.original_out, atmosphere: null });
}
