import { t } from '../../i18n';
import type { GraphicStyle, TextItem } from '../../timeline/model';
import { ValueSlider } from '../controls';
import { More } from '../layout';
import { Chips } from './parts';

const STYLES: { id: GraphicStyle; label: string }[] = [{ id: 'clean', label: 'Clean white' }, { id: 'documentary', label: 'Documentary yellow' }, { id: 'dark-band', label: 'Dark band' }, { id: 'bold-colour', label: 'Bold colour' }];

/** Before / after split: the two labels and where the divider goes; timing and the line's look under More. */
export function CompareGraphicFields({ text, onChange }: { text: TextItem; onChange: (changes: Partial<TextItem>, group?: string) => void }) {
  const graphic = text.graphic!;
  const set = (changes: Partial<typeof graphic>, group?: string) => onChange({ graphic: { ...graphic, ...changes } }, group);
  return <>
    <label className="ed-field"><span>{t('Before label')}</span><input value={graphic.before_label ?? ''} maxLength={40} lang="ta" onChange={(event) => set({ before_label: event.target.value }, `compare-before-${text.id}`)}/></label>
    <label className="ed-field"><span>{t('After label')}</span><input value={graphic.after_label ?? ''} maxLength={40} lang="ta" onChange={(event) => set({ after_label: event.target.value }, `compare-after-${text.id}`)}/></label>
    <ValueSlider label="Divider ends at" value={graphic.split_to ?? .5} min={0} max={1} step={.01} defaultValue={.5} unit="%" factor={100} onChange={(split_to, group) => set({ split_to }, group)}/>
    <Chips label="Style" options={STYLES} value={graphic.style} onPick={(style) => set({ style })}/>
    <ValueSlider label="Text size" value={text.size} min={20} max={100} step={1} defaultValue={44} onChange={(size, group) => onChange({ size }, group)}/>
    <More>
      <ValueSlider label="Divider starts at" value={graphic.split_from ?? 1} min={0} max={1} step={.01} defaultValue={1} unit="%" factor={100} onChange={(split_from, group) => set({ split_from }, group)}/>
      <ValueSlider label="Wait before sliding" value={graphic.split_delay ?? .3} min={0} max={Math.max(.1, Math.round(text.length * 10) / 10)} step={.1} defaultValue={.3} unit="s" decimals={1} onChange={(split_delay, group) => set({ split_delay }, group)}/>
      <ValueSlider label="Slide time" value={graphic.split_move ?? 1.2} min={.1} max={10} step={.1} defaultValue={1.2} unit="s" decimals={1} onChange={(split_move, group) => set({ split_move }, group)}/>
    </More>
    <p className="ed-tip">{t('The clip this divider reveals shows to the right of the line; the picture below it shows to the left.')}</p>
  </>;
}
