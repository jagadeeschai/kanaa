/**
 * Place in depth: one click puts a title behind whatever is nearer than it, worked out from how far away each part of
 * the clip is (not what it is): Behind people, Behind the scene (walls, trees and buildings in front, the title against
 * the sky), or a level of your own. In front takes it away. The first time, the clip's depth is worked out once.
 */
import { useContext, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { getPhoto } from '../../api/client';
import { t } from '../../i18n';
import { clearInFront, clipLength, depthOf, findText, mainLayer, placeInDepth, type TextItem } from '../../timeline/model';
import { ValueSlider } from '../controls';
import { newId } from '../editor-constants';
import { asVideo } from '../photoToVideo';
import { EditorContext } from '../state/EditorContext';

const PRESETS = [{ id: 'people', near: 0.6, label: 'Behind people', tip: 'People and anything as near come in front' },
  { id: 'scene', near: 0.15, label: 'Behind the scene', tip: 'Walls, trees and buildings come in front; the title sits against the far distance and the sky' }] as const;

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
    {level !== null && <ValueSlider label={t('How far back')} value={1 - level} min={0.05} max={0.95} step={0.05} defaultValue={0.65} unit="%" factor={100}
      onChange={(back, group) => { void place(1 - back, group ?? `depth-${text.id}`); }}/>}
    {level !== null && <p className="ed-tip">{t('Everything nearer than the title comes in front of it. The first time, Kanaa works out how near everything in the clip is (about a minute for 30 seconds); it then shows in the preview.')}</p>}
    {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Preparing the picture…')} {busy ? `${Math.round(busy)}%` : ''}</p>}
    {error && <p className="ed-error" role="alert">{error}</p>}
  </>;
}
