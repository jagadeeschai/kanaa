import { getJobStatus, getPhoto, makeEffect } from '../api/client';
import type { Photo } from '../types/photo';

/** An effect's video (effect_service.py), made once per frame size like any effect, waiting for it when it is new. */
export async function effectMedia(effectId: string, size: { width: number; height: number }): Promise<Photo> {
  const made = await makeEffect(effectId, size);
  if (made.media) return made.media;
  if (!made.job_id) throw new Error('Could not make the light.');
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const status = await getJobStatus(made.job_id) as unknown as { status?: string; error?: string | null; media_id?: number };
    if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make the light.');
    if (status.status === 'done' && status.media_id) return getPhoto(status.media_id);
  }
}
