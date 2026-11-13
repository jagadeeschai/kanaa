/**
 * Putting a title behind people (or an object, or under the sky) needs a video under it. Over a photo, Kanaa first
 * swaps the photo clip for a still video of the same picture (it looks the same: same picture, length and moves),
 * then the reveal goes on as over any video.
 */
import { getJobStatus, getPhoto, requestJson } from '../api/client';
import { clipLength, findClip, updateClip, type Clip, type Timeline } from '../timeline/model';
import type { Photo } from '../types/photo';

type Made = { status: 'ready' | 'preparing'; output_photo_id?: number; job_id?: string };

export async function stillVideo(mediaId: number, seconds: number, onProgress: (progress: number) => void = () => {}): Promise<Photo> {
  const made = await requestJson<Made>(`/api/photos/${mediaId}/still-video`, { method: 'POST', body: JSON.stringify({ seconds }) });
  let id = made.output_photo_id;
  while (!id && made.job_id) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; output_photo_id?: number };
    if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not prepare the picture.');
    if (status.status === 'done') id = status.output_photo_id;
    onProgress(status.progress);
  }
  if (!id) throw new Error('Could not prepare the picture.');
  return getPhoto(id);
}

/** The timeline with `clip` (a photo) playing its still video instead; the video's file, for the editor's media list. */
export async function asVideo(timeline: Timeline, clip: Clip, onProgress?: (progress: number) => void): Promise<{ timeline: Timeline; video: Photo }> {
  const video = await stillVideo(clip.media_id, clip.in + clipLength(clip) + 0.2, onProgress);
  return { timeline: findClip(timeline, clip.id) ? updateClip(timeline, clip.id, { media_id: video.id }) : timeline, video };
}
