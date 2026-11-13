/**
 * Picture lights for the selected picture: asks Kanaa whether it has a night sky or lamps, and only then brings them
 * alive. Which lamps glow is the person's choice: found for them (Apple Vision helps in brighter pictures), found in
 * any picture, or only where they draw a box.
 */
import { useState } from 'react';
import { getJobStatus, getPhoto, requestJson } from '../../api/client';
import { t } from '../../i18n';
import { type Clip } from '../../timeline/model';
import { placePictureLights } from '../../timeline/pictureLights';
import { boxInSource } from '../../timeline/tracking';
import { Group } from '../layout';
import { useEditor } from '../state/EditorContext';

type Made = { status: 'none' | 'ready' | 'preparing'; reason?: string; output_photo_id?: number; job_id?: string };
type LampMode = 'auto' | 'always' | 'marked' | 'off';
const MODES: [LampMode, string, string][] = [
  ['auto', 'Find them for me', 'Dusk and night pictures, and brighter ones where Apple Vision sees lamps or lanterns.'],
  ['always', 'Also in bright pictures', 'Every warm light that stands out, even by day.'],
  ['marked', 'Only where I mark', 'Draw a box round each lamp or lantern; Kanaa finds the flame inside it, or lights the box.'],
  ['off', 'No lamps', 'Only the night sky.'],
];
let count = 0;
const id = (kind: string) => `${kind}-${Date.now().toString(36)}-${(count += 1)}`;

export function PictureLightsGroup({ clip, source }: { clip: Clip; source: { width: number; height: number } }) {
  const { timeline, change, addMedia, drawBox, now } = useEditor();
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [mode, setMode] = useState<LampMode>('auto');
  const [marks, setMarks] = useState<number[][]>([]);  // [x0, y0, x1, y1] shares of the picture.
  const mark = () => drawBox((box) => {
    const inside = boxInSource(clip, source, timeline.format, Math.max(0, now - clip.start), box);
    if (!inside) { setNote(t('Draw the box on the picture itself.')); return; }
    const [x, y, w, h] = inside;
    setMarks((current) => [...current, [x - w / 2, y - h / 2, x + w / 2, y + h / 2].map((value) => Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000)]);
    setNote(null);
  });
  const add = async () => {
    setNote(null); setBusy(0);
    try {
      const length = (clip.out - clip.in) / clip.speed;
      const body = { seconds: Math.min(600, length), lamps: mode, ...(mode === 'marked' ? { regions: marks } : {}) };
      const made = await requestJson<Made>(`/api/photos/${clip.media_id}/lights`, { method: 'POST', body: JSON.stringify(body) });
      if (made.status === 'none') { setNote(t(made.reason ?? 'Nothing to light in this picture.')); return; }
      let lights = made.output_photo_id;
      while (!lights && made.job_id) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; output_photo_id?: number };
        if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make the picture lights.');
        if (status.status === 'done') lights = status.output_photo_id;
        setBusy(status.progress);
      }
      if (!lights) throw new Error('Could not make the picture lights.');
      const item = await getPhoto(lights);
      addMedia(item);
      change(placePictureLights(timeline, clip, item, { clip: id('lights'), layer: id('layer') }));
      setNote(t('Added on the Picture lights layer. Hide or delete that layer to take it off.'));
    } catch (problem) { setNote((problem as Error).message); } finally { setBusy(null); }
  };
  const tip = MODES.find(([value]) => value === mode)?.[2] ?? '';
  return <Group title="Picture lights" tab="effects" keywords="night sky stars moon glow twinkle sparkle shooting star lamp lantern diya flame flicker light" tip="Only what the picture has: a night sky twinkles and its moon glows; oil lamps and lanterns flicker with a warm halo.">
    <div className="ed-chips" role="group" aria-label={t('Lamps')}>{MODES.map(([value, label]) => <button key={value} className={mode === value ? 'on' : ''} aria-pressed={mode === value} onClick={() => setMode(value)}>{t(label)}</button>)}</div>
    <p className="ed-tip">{t(tip)}</p>
    {mode === 'marked' && <div className="ed-chips" role="group" aria-label={t('Marked lamps')}>
      <button onClick={mark}>{t('Mark a lamp')}</button>
      {marks.length > 0 && <button onClick={() => setMarks([])}>{t('Clear {count} marked', { count: marks.length })}</button>}
    </div>}
    <button className="ed-button wide" disabled={busy !== null || (mode === 'marked' && !marks.length)} onClick={() => { void add(); }}>{busy === null ? t('Bring its lights alive') : `${t('Looking for lights…')} ${busy}%`}</button>
    {note && <p className="ed-tip" role="status">{note}</p>}
  </Group>;
}
