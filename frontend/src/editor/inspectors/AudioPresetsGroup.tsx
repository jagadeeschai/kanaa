/** One-click sound presets for a sound or a clip's sound: each a toggle, several can be on. */
import { AUDIO_PRESETS, type AudioPresetId } from '../../timeline/audioPresets';
import { t } from '../../i18n';

export function AudioPresets({ value, onChange }: { value: AudioPresetId[] | undefined; onChange: (presets: AudioPresetId[]) => void }) {
  const on = new Set(value ?? []);
  const toggle = (id: AudioPresetId) => onChange(AUDIO_PRESETS.map((preset) => preset.id).filter((entry) => (entry === id ? !on.has(id) : on.has(entry))));
  return <>
    <h3 className="ed-sub">{t('Sound presets')}</h3>
    <div className="ed-chips" role="group" aria-label={t('Sound presets')}>
      {AUDIO_PRESETS.map((preset) => <button key={preset.id} className={on.has(preset.id) ? 'on' : ''} aria-pressed={on.has(preset.id)} title={t(preset.about)} onClick={() => toggle(preset.id)}>{t(preset.label)}</button>)}
    </div>
  </>;
}
