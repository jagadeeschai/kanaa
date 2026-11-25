/**
 * Fine-tune: under each cinematic look's presets, folded away, a few sliders that start exactly where the chosen preset
 * is (the backend says where, /api/look-tuning) and Reset back to it. Only the settings moved are kept with the clip.
 */
import { useEffect, useState } from 'react';
import { requestJson } from '../api/client';
import { t } from '../i18n';
import { ValueSlider } from './controls';

export type TuneLook = 'lens' | 'atmosphere' | 'sky' | 'night' | 'rays' | 'freeze3d' | 'match' | 'blur';
export type Tune = Record<string, number>;
type Tuning = Record<TuneLook, { knobs: Record<string, [number, number]> }> & { defaults: Record<TuneLook, Record<string, Tune>> };

// What each setting is called, and how it shows (as a percent unless said).
const LABELS: Record<TuneLook, Record<string, { label: string; percent?: boolean; decimals?: number }>> = {
  lens: { amount: { label: 'Blur amount', percent: true }, focus: { label: 'Focus distance (far → near)', percent: true } },
  atmosphere: { density: { label: 'Thickness', percent: true }, fade: { label: 'Colour fade', percent: true }, most: { label: 'Most it covers', percent: true } },
  sky: { amount: { label: 'How much the land takes the sky’s light', percent: true } },
  night: { land: { label: 'Land brightness', percent: true }, sky: { label: 'Sky brightness', percent: true }, colour: { label: 'Colour kept', percent: true } },
  rays: { reach: { label: 'Reach', percent: true }, decay: { label: 'Fade (higher reaches further)', decimals: 3 }, strength: { label: 'Brightness', percent: true } },
  blur: { shutter: { label: 'Shutter (50% is film’s 180°)', percent: true } },
  match: { amount: { label: 'How strongly', percent: true }, skin: { label: 'Protect skin tones', percent: true } },
  freeze3d: { swing: { label: 'Camera travel', percent: true, decimals: 1 }, push: { label: 'Push in', percent: true }, parallax: { label: 'Depth strength', decimals: 1 } },
};

let loaded: Promise<Tuning> | null = null;
const tuning = () => (loaded ??= requestJson<Tuning>('/api/look-tuning'));

/** `preset` is the preset's key in the backend's defaults (e.g. "mist/medium", "sunset", "orbit-right"). */
export function TuneSection({ look, preset, tune, onChange, disabled }: { look: TuneLook; preset: string; tune: Tune; onChange: (tune: Tune) => void; disabled?: boolean }) {
  const [known, setKnown] = useState<Tuning | null>(null);
  useEffect(() => { let live = true; tuning().then((found) => { if (live) setKnown(found); }).catch(() => undefined); return () => { live = false; }; }, []);
  if (!known) return null;
  const knobs = known[look]?.knobs ?? {};
  const defaults = known.defaults[look]?.[preset] ?? {};
  const keys = Object.keys(knobs).filter((key) => key in defaults);
  if (!keys.length) return null;
  const changed = keys.some((key) => key in tune);
  return <details className="ed-tune" open={changed}>
    <summary>{t('Fine-tune')}{changed ? ` · ${t('changed')}` : ''}</summary>
    {keys.map((key) => {
      const [min, max] = knobs[key];
      const shown = LABELS[look][key] ?? { label: key };
      const percent = shown.percent ?? false;
      return <ValueSlider key={key} label={t(shown.label)} value={tune[key] ?? defaults[key]} min={min} max={max} step={max - min > 0.5 ? 0.01 : max - min > 0.1 ? 0.005 : 0.001}
        defaultValue={defaults[key]} unit={percent ? '%' : ''} factor={percent ? 100 : 1} decimals={shown.decimals ?? (percent ? 0 : 2)}
        onChange={(value) => { if (!disabled) onChange({ ...tune, [key]: Math.round(value * 10000) / 10000 }); }}/>;
    })}
    {changed && <button className="ed-button" disabled={disabled} onClick={() => onChange({})}>{t('Reset to the preset')}</button>}
  </details>;
}
