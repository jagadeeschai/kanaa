/**
 * The lyric screen's finish: the same full build an agent makes through MCP (backend kanaa_mcp/lyric_builder.py), from
 * a few plain choices — mood, how lines move, the brand, the credits and the owner's house style.
 */
import { useEffect, useState } from 'react';
import { listPhotos } from '../api/client';
import type { Photo } from '../types/photo';
import { t } from '../i18n';
import KanaaSelect from './KanaaSelect';

export type LyricBuildChoices = {
  look: 'energetic' | 'romantic' | 'calm';
  lyric_motion: 'plain' | 'into_clear';
  house_style: boolean;
  brand_intro: boolean;
  logo_media_id: number | null;
  song_by: string; music: string; presented_by: string; footer: string;
};

export const DEFAULT_BUILD: LyricBuildChoices = {
  look: 'romantic', lyric_motion: 'plain', house_style: true, brand_intro: true, logo_media_id: null,
  song_by: '', music: '', presented_by: '', footer: '',
};
const KEY = 'kanaa-lyric-build';  // The last choices, as most songs share the brand and credits.

export function rememberedBuild(): LyricBuildChoices {
  try { return { ...DEFAULT_BUILD, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULT_BUILD; }
}

const input = 'theme-control mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100';

export default function LyricBuildOptions({ value, onChange }: { value: LyricBuildChoices; onChange: (next: LyricBuildChoices) => void }) {
  const [logos, setLogos] = useState<Photo[]>([]);
  useEffect(() => {
    listPhotos({ folder: 'Brand', media_type: 'image', limit: 50 }).then((result) => {
      const found = result.photos ?? [];
      setLogos(found);
      if (value.logo_media_id === null && found[0]) onChange({ ...value, logo_media_id: found[0].id });
    }).catch(() => {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const set = (changes: Partial<LyricBuildChoices>) => {
    const next = { ...value, ...changes };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
    onChange(next);
  };
  const text = (key: 'song_by' | 'music' | 'presented_by' | 'footer', label: string, hint: string) =>
    <label className="block text-xs text-slate-400">{t(label)}<input aria-label={t(label)} className={input} value={value[key]} placeholder={t(hint)} maxLength={120} onChange={(event) => set({ [key]: event.target.value })}/></label>;
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs text-slate-400">{t('Mood')}<KanaaSelect aria-label={t('Mood')} value={value.look} onChange={(event) => set({ look: event.target.value as LyricBuildChoices['look'] })} className="mt-1">
        <option value="romantic">{t('Romantic')}</option><option value="energetic">{t('Energetic')}</option><option value="calm">{t('Calm')}</option></KanaaSelect></label>
      <label className="block text-xs text-slate-400">{t('How lines move')}<KanaaSelect aria-label={t('How lines move')} value={value.lyric_motion} onChange={(event) => set({ lyric_motion: event.target.value as LyricBuildChoices['lyric_motion'] })} className="mt-1">
        <option value="plain">{t('Simple')}</option><option value="into_clear">{t('Glide into clear space')}</option></KanaaSelect></label>
    </div>
    <label className="flex items-start gap-2 text-sm text-slate-200"><input type="checkbox" checked={value.house_style} onChange={(event) => set({ house_style: event.target.checked })} className="mt-1 accent-brand-400"/>
      <span>{t('House style')}<span className="block text-xs text-slate-400">{t('Lines answer each other from both sides, a title card and a lower-third, a touch on each scene.')}</span></span></label>
    <label className="flex items-start gap-2 text-sm text-slate-200"><input type="checkbox" checked={value.brand_intro} disabled={!logos.length} onChange={(event) => set({ brand_intro: event.target.checked })} className="mt-1 accent-brand-400"/>
      <span>{t('Brand intro')}<span className="block text-xs text-slate-400">{logos.length ? t('Your logo comes to life at the start, then stays small in the corner.') : t('Put your logo in the Brand folder in Media to use it.')}</span></span></label>
    {logos.length > 0 && <label className="block text-xs text-slate-400">{t('Logo')}<KanaaSelect aria-label={t('Logo')} value={String(value.logo_media_id ?? '')} onChange={(event) => set({ logo_media_id: event.target.value ? Number(event.target.value) : null })} className="mt-1">
      <option value="">{t('No logo')}</option>{logos.map((logo) => <option key={logo.id} value={logo.id}>{logo.filename}</option>)}</KanaaSelect></label>}
    <fieldset className="space-y-2"><legend className="text-xs font-medium text-slate-300">{t('Credits')} <span className="font-normal text-slate-500">{t('(leave out what you do not know)')}</span></legend>
      {text('song_by', 'Lyricist', 'e.g. பாவேந்தர் பாரதிதாசன்')}
      {text('music', 'Music', 'e.g. Made with Suno')}
      {text('presented_by', 'Presented by', 'e.g. கவின்தமிழ் Originals')}
      {text('footer', 'Footer', 'e.g. @yourchannel · Lyric video with Kanaa')}
    </fieldset>
  </div>;
}
