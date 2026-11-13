/** Night sky sparkle for the selected picture: asks Kanaa whether it has a night sky, and only then lays the light over it. */
import { useState } from 'react';
import { getJobStatus, getPhoto, requestJson } from '../../api/client';
import { t } from '../../i18n';
import { type Clip } from '../../timeline/model';
import { placeNightSky } from '../../timeline/nightSky';
import { Group } from '../layout';
import { useEditor } from '../state/EditorContext';

type Made = { status: 'none' | 'ready' | 'preparing'; reason?: string; output_photo_id?: number; job_id?: string };
let count = 0;
const id = (kind: string) => `${kind}-${Date.now().toString(36)}-${(count += 1)}`;

export function NightSkyGroup({ clip }: { clip: Clip }) {
  const { timeline, change, addMedia } = useEditor();
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const add = async () => {
    setNote(null); setBusy(0);
    try {
      const length = (clip.out - clip.in) / clip.speed;
      const made = await requestJson<Made>(`/api/photos/${clip.media_id}/night-sky`, { method: 'POST', body: JSON.stringify({ seconds: Math.min(600, length) }) });
      if (made.status === 'none') { setNote(t(made.reason ?? 'No night sky found in this picture.')); return; }
      let sky = made.output_photo_id;
      while (!sky && made.job_id) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; output_photo_id?: number };
        if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make the night sky.');
        if (status.status === 'done') sky = status.output_photo_id;
        setBusy(status.progress);
      }
      if (!sky) throw new Error('Could not make the night sky.');
      const item = await getPhoto(sky);
      addMedia(item);
      change(placeNightSky(timeline, clip, item, { clip: id('sky'), layer: id('layer') }));
      setNote(t('Added on the Night sky layer. Hide or delete that layer to take it off.'));
    } catch (problem) { setNote((problem as Error).message); } finally { setBusy(null); }
  };
  return <Group title="Night sky" tab="effects" keywords="night sky stars moon glow twinkle sparkle shooting star" tip="Only for a picture with a night sky: stars twinkle in the sky (never on trees or people) and the moon glows.">
    <button className="ed-button wide" disabled={busy !== null} onClick={() => { void add(); }}>{busy === null ? t('Add night sky sparkle') : `${t('Looking at the sky…')} ${busy}%`}</button>
    {note && <p className="ed-tip" role="status">{note}</p>}
  </Group>;
}
