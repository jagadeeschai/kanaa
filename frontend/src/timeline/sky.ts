/** Sky swap on the timeline: the clip plays a made copy of its part under a new sky, the land relit (sky_swap_service.py);
 *  Remove new sky puts the original back, exactly as it was. */
import { findClip, updateClip, type Clip, type Timeline } from './model.ts';

export type SkyChoice = 'sunset' | 'night' | 'storm' | 'blue';
export const SKY_CHOICES: { id: SkyChoice; label: string; about: string }[] = [
  { id: 'sunset', label: 'Golden sunset', about: 'A deep orange sky with the sun low over the horizon; the land glows warm' },
  { id: 'night', label: 'Starry night', about: 'Stars and a moon; the land turns to blue night' },
  { id: 'storm', label: 'Storm clouds', about: 'Heavy grey clouds rolling in; the colour goes muted' },
  { id: 'blue', label: 'Clear blue', about: 'A bright blue sky with soft white clouds' },
];

/** What the sky needs from a clip: its source and the part it plays (the original when it already has a new sky). */
export function skyPart(clip: Clip) {
  const original = clip.new_sky;
  return original ? { media: original.original_media_id, start: original.original_in, end: original.original_out } : { media: clip.media_id, start: clip.in, end: clip.out };
}

export function cannotSky(clip: Clip): string | null {
  if (clip.reverse || clip.ramp || clip.freeze != null) return 'Sky swap works on a clip that plays normally (not reversed, ramped or frozen).';
  if (clip.lens || clip.atmosphere || clip.slowmo) return 'Take off the lens, atmosphere or slow motion first, add the new sky, then put them back.';
  return null;
}

export function applySky(timeline: Timeline, clipId: string, made: number, sky: SkyChoice): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip) return timeline;
  const part = skyPart(clip);
  return updateClip(timeline, clipId, { media_id: made, in: 0, out: Math.round((part.end - part.start) * 1000) / 1000,
    new_sky: { original_media_id: part.media, original_in: part.start, original_out: part.end, sky } });
}

export function removeSky(timeline: Timeline, clipId: string): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip?.new_sky) return timeline;
  return updateClip(timeline, clipId, { media_id: clip.new_sky.original_media_id, in: clip.new_sky.original_in, out: clip.new_sky.original_out, new_sky: null });
}
