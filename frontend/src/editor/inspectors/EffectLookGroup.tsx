import { t } from '../../i18n';
import { colourChanges, currentColour, EFFECT_COLOURS, EFFECT_SIZES } from '../../timeline/effect-look';
import type { Clip } from '../../timeline/model';
import { ValueSlider } from '../controls';
import { Group } from '../layout';
import { Chips } from './parts';

/** For an overlay effect (Effects layer): its colour, size and strength, in one place, always shown. */
export function EffectLookGroup({ clip, onChange, onPause }: { clip: Clip; onChange: (changes: Partial<Clip>, group?: string) => void; onPause: () => void }) {
  const colour = currentColour(clip);
  const scale = clip.transform.scale;
  const size = EFFECT_SIZES.find((each) => Math.abs(each.scale - scale) < 1e-3)?.id ?? null;
  const strength = clip.adjust.brightness;
  return <Group title="Effect look" tab="frame" startOpen changed={colour !== 'original' || scale !== 1 || strength !== 1} keywords="effect colour color tint light size bigger smaller intensity strength brightness" tip="The colour, size and strength of this effect." help="special-effects">
    <div className="ed-field-label">{t('Colour')}</div>
    <div className="ed-swatches" role="group" aria-label={t('Colour')}>{EFFECT_COLOURS.map((each) =>
      <button key={each.id} className={`ed-swatch ${colour === each.id ? 'on' : ''}`} style={{ background: each.swatch }} title={t(each.label)} aria-label={t(each.label)} aria-pressed={colour === each.id} onClick={() => onChange(colourChanges(clip, each.id))}/>)}</div>
    <ValueSlider label="Strength" value={strength} min={0.3} max={1.8} step={0.05} defaultValue={1} unit="%" factor={100} onGestureStart={onPause} onChange={(brightness, group) => onChange({ adjust: { ...clip.adjust, brightness } }, group)}/>
    <Chips label="Size" options={EFFECT_SIZES.map(({ id, label }) => ({ id, label }))} value={size} onPick={(id) => onChange({ transform: { ...clip.transform, scale: EFFECT_SIZES.find((each) => each.id === id)!.scale } })}/>
    <ValueSlider label="Exact size" value={scale} min={0.4} max={2.5} step={0.05} defaultValue={1} unit="%" factor={100} onGestureStart={onPause} onChange={(value, group) => onChange({ transform: { ...clip.transform, scale: value } }, group)}/>
  </Group>;
}
