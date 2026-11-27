/** Title on fire: one click sets a title's letters burning (timeline/titlefire.ts); Put out takes the fire away. */
import { useState } from 'react';
import { Flame, LoaderCircle } from 'lucide-react';
import { getPhoto, requestJson, waitForJob } from '../../api/client';
import { t } from '../../i18n';
import type { TextItem } from '../../timeline/model';
import { FIRE_STRENGTHS, fireOf, withTitleFire, withoutTitleFire, type FireStrength } from '../../timeline/titlefire';
import { Group } from '../layout';
import { useEditor } from '../state/EditorContext';

export function TitleFireGroup({ text }: { text: TextItem }) {
  const { timeline, change, addMedia } = useEditor();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const burning = timeline ? fireOf(timeline, text.id) : null;
  const ignite = async (strength: FireStrength) => {
    if (!timeline) return;
    setError(null); setBusy(0);
    try {
      const started = await requestJson<{ status: string; output_photo_id?: number; seconds?: number; job_id?: string }>('/api/text-fire',
        { method: 'POST', body: JSON.stringify({ text, format: timeline.format, strength }) });
      const made = started.output_photo_id != null ? started : await waitForJob<{ output_photo_id: number; seconds: number }>(started.job_id!, setBusy);
      addMedia(await getPhoto(made.output_photo_id!));
      change(withTitleFire(timeline, text, made.output_photo_id!, made.seconds ?? 4, strength), `fire-${text.id}`);
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  return <Group title="Title on fire" tab="style" startOpen={Boolean(burning)} changed={Boolean(burning)} keywords="fire flame flames burning burn blaze inferno embers hot title"
    tip="Flames rise from the title's own letters and embers drift off them. Moved or retyped the title? Set it on fire again so the flames follow.">
    <div className="ed-chips" role="group" aria-label={t('Title on fire')}>
      {FIRE_STRENGTHS.map((choice) => { const on = burning?.strength === choice.id; return <button key={choice.id} className={on ? 'on' : ''} aria-pressed={on} title={t(choice.about)}
        disabled={busy !== null} onClick={() => { void ignite(choice.id); }}><Flame size={13}/> {t(choice.label)}</button>; })}
    </div>
    {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Setting the title on fire…')} {busy ? `${Math.round(busy)}%` : ''}</p>}
    {error && <p className="ed-error" role="alert">{error}</p>}
    {burning && <button className="ed-button wide" disabled={busy !== null} onClick={() => timeline && change(withoutTitleFire(timeline, text.id))}>{t('Put the fire out')}</button>}
  </Group>;
}
