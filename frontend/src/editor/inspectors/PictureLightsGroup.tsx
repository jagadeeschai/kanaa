/** Picture lights for the selected picture: asks Kanaa whether it has a night sky or lamps, and only then brings them alive. */
import { useState } from 'react';
import { getJobStatus, getPhoto, requestJson } from '../../api/client';
import { t } from '../../i18n';
import { type Clip } from '../../timeline/model';
import { placePictureLights } from '../../timeline/pictureLights';
import { Group } from '../layout';
import { useEditor } from '../state/EditorContext';

type Made = { status: 'none' | 'ready' | 'preparing'; reason?: string; output_photo_id?: number; job_id?: string };
let count = 0;
const id = (kind: string) => `${kind}-${Date.now().toString(36)}-${(count += 1)}`;

export function PictureLightsGroup({ clip }: { clip: Clip }) {
  const { timeline, change, addMedia } = useEditor();
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const add = async () => {
    setNote(null); setBusy(0);
    try {
      const length = (clip.out - clip.in) / clip.speed;
      const made = await requestJson<Made>(`/api/photos/${clip.media_id}/lights`, { method: 'POST', body: JSON.stringify({ seconds: Math.min(600, length) }) });
      if (made.status === 'none') { setNote(t(made.reason ?? 'Nothing to light in this picture.')); return; }
      let sky = made.output_photo_id;
      while (!sky && made.job_id) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; output_photo_id?: number };
        if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make the picture lights.');
        if (status.status === 'done') sky = status.output_photo_id;
        setBusy(status.progress);
      }
      if (!sky) throw new Error('Could not make the picture lights.');
      const item = await getPhoto(sky);
      addMedia(item);
      change(placePictureLights(timeline, clip, item, { clip: id('sky'), layer: id('layer') }));
      setNote(t('Added on the Picture lights layer. Hide or delete that layer to take it off.'));
    } catch (problem) { setNote((problem as Error).message); } finally { setBusy(null); }
  };
  return <Group title="Picture lights" tab="effects" keywords="night sky stars moon glow twinkle sparkle shooting star lamp lantern diya flame flicker light" tip="Only what the picture has: a night sky twinkles and its moon glows; oil lamps and lanterns flicker with a warm halo.">
    <button className="ed-button wide" disabled={busy !== null} onClick={() => { void add(); }}>{busy === null ? t('Bring its lights alive') : `${t('Looking for lights…')} ${busy}%`}</button>
    {note && <p className="ed-tip" role="status">{note}</p>}
  </Group>;
}
