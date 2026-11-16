/** One "Add an effect" row for a clip: the effects not yet on it, each one click. An effect in use shows its own group
 * of controls below (and Turn off there); the rest stay out of the way. */
import { useContext } from 'react';
import { Plus } from 'lucide-react';
import { DEFAULT_BEAT_PULSE, DEFAULT_COLOUR_SPLASH, DEFAULT_DREAMY_GLOW, DEFAULT_ECHO, DEFAULT_LENS_SURFACE, DEFAULT_MIRROR, DEFAULT_OLD_FILM, DEFAULT_SIGNAL_DAMAGE, DEFAULT_TILT_SHIFT, DEFAULT_TONE_GRADE, DEFAULT_ZOOM_BLUR, type Clip } from '../../timeline/model';
import { Group, SimpleContext } from '../layout';
import { t } from '../../i18n';

type Key = 'colour_splash' | 'dreamy_glow' | 'tone_grade' | 'tilt_shift' | 'mirror' | 'zoom_blur' | 'echo' | 'beat_pulse' | 'old_film' | 'signal_damage' | 'lens_surface';
/** In the order of their groups. `pro` ones are left out in Simple mode, as their groups are. */
export const CLIP_EFFECTS: { key: Key; label: string; about: string; pro?: boolean; start: () => Partial<Clip> }[] = [
  { key: 'colour_splash', label: 'Colour splash', about: 'Keep one colour; the rest goes black and white', start: () => ({ colour_splash: { ...DEFAULT_COLOUR_SPLASH } }) },
  { key: 'dreamy_glow', label: 'Dreamy glow', about: 'A gentle warm bloom', start: () => ({ dreamy_glow: { ...DEFAULT_DREAMY_GLOW } }) },
  { key: 'old_film', label: 'Old film', about: 'Grain, scratches and flicker', start: () => ({ old_film: { ...DEFAULT_OLD_FILM } }) },
  { key: 'signal_damage', label: 'Signal damage', about: 'Glitch or VHS', start: () => ({ signal_damage: { ...DEFAULT_SIGNAL_DAMAGE } }) },
  { key: 'lens_surface', label: 'Lens surface', about: 'Raindrops or dirt on the glass', start: () => ({ lens_surface: { ...DEFAULT_LENS_SURFACE } }) },
  { key: 'tone_grade', label: 'Duotone and split-tone', about: 'A two-colour grade', pro: true, start: () => ({ tone_grade: { ...DEFAULT_TONE_GRADE } }) },
  { key: 'tilt_shift', label: 'Tilt-shift', about: 'A sharp band, soft above and below', pro: true, start: () => ({ tilt_shift: { ...DEFAULT_TILT_SHIFT } }) },
  { key: 'mirror', label: 'Mirror and kaleidoscope', about: 'Mirrored halves or a kaleidoscope', pro: true, start: () => ({ mirror: { ...DEFAULT_MIRROR } }) },
  { key: 'zoom_blur', label: 'Zoom blur', about: 'Streaks rushing from a point', pro: true, start: () => ({ zoom_blur: { ...DEFAULT_ZOOM_BLUR } }) },
  { key: 'echo', label: 'Echo trail', about: 'Ghost trails behind movement', pro: true, start: () => ({ echo: { ...DEFAULT_ECHO } }) },
  { key: 'beat_pulse', label: 'Beat pulse', about: 'A small zoom on each beat', pro: true, start: () => ({ beat_pulse: { ...DEFAULT_BEAT_PULSE } }) },
];

export function EffectPicker({ clip, onChange }: { clip: Clip; onChange: (changes: Partial<Clip>) => void }) {
  const simple = useContext(SimpleContext);
  const free = CLIP_EFFECTS.filter((effect) => !clip[effect.key] && !(simple && effect.pro));
  const used = CLIP_EFFECTS.length - CLIP_EFFECTS.filter((effect) => !clip[effect.key]).length;
  if (!free.length) return null;
  return <Group title="Add an effect" tab="effects" startOpen keywords="effect add colour splash dreamy glow old film glitch vhs rain tilt mirror zoom echo beat" summary={used ? t('{count} on', { count: used }) : undefined}
    tip="Click one to add it. Its controls appear below, with Turn off.">
    <div className="ed-chips ed-chips-add" role="group" aria-label={t('Add an effect')}>
      {free.map((effect) => <button key={effect.key} title={t(effect.about)} onClick={() => onChange(effect.start())}><Plus size={12}/>{t(effect.label)}</button>)}
    </div>
  </Group>;
}
