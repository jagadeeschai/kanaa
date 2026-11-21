/**
 * Place in depth: one click puts a title behind whatever is nearer than it, worked out from how far away each part of
 * the clip is (not what it is): Behind people, Behind the scene (walls, trees and buildings in front, the title against
 * the sky), or a level of your own. In front takes it away. The first time, the clip's depth is worked out once.
 */
import { useContext, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { getPhoto, requestJson, waitForJob } from '../../api/client';
import { t } from '../../i18n';
import { clearInFront, clipLength, depthOf, findText, mainLayer, placeInDepth, updateText, type TextItem } from '../../timeline/model';
import { onTheSkyline } from '../../timeline/skyline';
import { ValueSlider } from '../controls';
import { newId } from '../editor-constants';
import { asVideo } from '../photoToVideo';
import { EditorContext } from '../state/EditorContext';

const SKYLINE_LEVEL = 0.25;  // As Behind the scene and depth_mask_service.SKY_LEVEL.
const PRESETS = [{ id: 'people', near: 0.55, label: 'Behind people', tip: 'People and anything as near come in front' },
  { id: 'scene', near: 0.25, label: 'Behind the scene', tip: 'Walls, trees and buildings come in front; the title sits against the far distance and the sky' }] as const;

export function DepthPlacer({ text }: { text: TextItem }) {
  const store = useContext(EditorContext);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!store?.timeline) return null;
  const timeline = store.timeline;
  const under = mainLayer(timeline).items.find((item) => text.start >= item.start && text.start < item.start + clipLength(item));
  if (!under) return null;
  const level = depthOf(timeline, text.id);
  const preset = PRESETS.find((each) => level !== null && Math.abs(each.near - level) < 0.005)?.id ?? (level === null ? 'front' : 'custom');

  /** The clip under the title as a video (a picture becomes a still video first), in the timeline to change. */
  const asClip = async (): Promise<typeof store.timeline> => {
    let base = store.timeline!;
    const clip = mainLayer(base).items.find((item) => item.id === under.id)!;
    if ((await getPhoto(clip.media_id)).media_type === 'image') {
      setBusy(0);
      try { const made = await asVideo(base, clip, (progress) => setBusy(progress)); store.addMedia(made.video); base = made.timeline; }
      finally { setBusy(null); }
    }
    return base;
  };
  /** Sit on the skyline: the title rests on where the land meets the sky behind it, following it as the camera moves. */
  const sit = async () => {
    setError(null);
    try {
      const base = (await asClip())!;
      const clip = mainLayer(base).items.find((item) => item.id === under.id)!;
      const current = findText(base, text.id)?.text ?? text;
      const step = 0.5, moments: number[] = [];
      for (let at = 0; at <= current.length + 1e-6; at += step) moments.push(Math.min(current.length, at));
      const source = moments.map((at) => clip.in + Math.max(0, current.start + at - clip.start) * clip.speed);
      const ask = () => requestJson<{ status: string; job_id?: string; box?: [number, number, number, number]; skyline?: (number | null)[] }>('/api/skyline', { method: 'POST', body: JSON.stringify({ text: current, format: base.format, media_id: clip.media_id, times: source }) });
      let found = await ask();
      if (found.status === 'preparing') { setBusy(0); await waitForJob(found.job_id!, (progress) => setBusy(progress)); setBusy(null); found = await ask(); }
      const transform = onTheSkyline(current.transform, found.box!, moments, found.skyline!);
      if (!transform) { setError(t('No sky was found above the land behind this title.')); return; }
      const placed = updateText(base, text.id, { transform });
      store.change(placeInDepth(placed, text.id, SKYLINE_LEVEL, [newId(), newId()]));
    } catch (problem) { setError((problem as Error).message); setBusy(null); }
  };
  const place = async (near: number, group?: string) => {
    setError(null);
    let base = store.timeline!;
    const clip = mainLayer(base).items.find((item) => item.id === under.id)!;
    // A picture becomes a still video first, so its depth can be worked out like any clip's.
    if ((await getPhoto(clip.media_id)).media_type === 'image') {
      setBusy(0);
      try { const made = await asVideo(base, clip, (progress) => setBusy(progress)); store.addMedia(made.video); base = made.timeline; }
      catch (problem) { setError((problem as Error).message); setBusy(null); return; }
      setBusy(null);
    }
    if (!findText(base, text.id)) return;
    const next = placeInDepth(base, text.id, near, [newId(), newId()]);
    if (next === base) { setError(t('Place in depth needs a free video layer: delete one you no longer use.')); return; }
    store.change(next, group);
  };
  return <>
    <h3 className="ed-sub">{t('Place in depth')}</h3>
    <div className="ed-chips" role="group" aria-label={t('Place in depth')}>
      <button className={preset === 'front' ? 'on' : undefined} aria-pressed={preset === 'front'} disabled={busy !== null} onClick={() => store.change(clearInFront(timeline, text.id))}>{t('In front')}</button>
      {PRESETS.map((each) => <button key={each.id} className={preset === each.id ? 'on' : undefined} aria-pressed={preset === each.id} disabled={busy !== null} title={t(each.tip)} onClick={() => { void place(each.near); }}>{t(each.label)}</button>)}
      <button className={preset === 'custom' ? 'on' : undefined} aria-pressed={preset === 'custom'} disabled={busy !== null} title={t('Choose how far back the title sits')} onClick={() => { void place(level ?? 0.35); }}>{t('Custom')}</button>
    </div>
    <button className="ed-button wide" disabled={busy !== null} title={t('Finds where the land meets the sky behind the title and rests it there, following it as the camera moves')} onClick={() => { void sit(); }}>{t('Sit on the skyline')}</button>
    {level !== null && <ValueSlider label={t('How far back')} value={1 - level} min={0.05} max={0.95} step={0.05} defaultValue={0.65} unit="%" factor={100}
      onChange={(back, group) => { void place(1 - back, group ?? `depth-${text.id}`); }}/>}
    {level !== null && <p className="ed-tip">{t('Everything nearer than the title comes in front of it. The first time, Kanaa works out how near everything in the clip is (about a minute for 30 seconds); it then shows in the preview.')}</p>}
    {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Preparing the picture…')} {busy ? `${Math.round(busy)}%` : ''}</p>}
    {error && <p className="ed-error" role="alert">{error}</p>}
  </>;
}
