/** An adjustment span: one-click scene looks, then its colour and fades under "More". Reads everything from the store. */
import { SlidersHorizontal } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { ADJUST_PRESETS, findAdjust, updateAdjust, withPreset } from '../../timeline/adjust';
import { DEFAULT_ADJUST, moveItem, trimText, type AdjustItem, type Adjust } from '../../timeline/model';
import { ValueSlider, type TimeFieldProps } from '../controls';
import { Timing, timingSummary } from '../Timing';
import { Group, More, Panel } from '../layout';
import { Chips } from './parts';
import { LOOK_NAMES } from './clip-parts';
import { ColourWheelsGroup } from './ColourWheelsGroup';
import { t } from '../../i18n';

export function AdjustInspector() {
  const { timeline, change, selectedId } = useEditor();
  const span = findAdjust(timeline, selectedId)?.span;
  if (!span) return null;
  const fps = timeline.format.fps;
  const set = (changes: Partial<AdjustItem>, group?: string) => change(updateAdjust(timeline, span.id, changes), group);
  const tone = (key: keyof Adjust) => (value: number, group?: string) => set({ adjust: { ...span.adjust, [key]: value } }, group);
  const timing: TimeFieldProps[] = [
    { label: 'Start', value: span.start, fps, onChange: (at) => change(moveItem(timeline, span.id, at)) },
    { label: 'Duration', value: span.length, fps, onChange: (at) => change(trimText(timeline, span.id, 'out', span.start + at)) },
    { label: 'End', value: span.start + span.length, fps, onChange: (at) => change(trimText(timeline, span.id, 'out', at)) },
  ];
  const preset = ADJUST_PRESETS.find((entry) => entry.label === span.name)?.id ?? null;
  return <Panel id="adjust" tabs={[{ id: 'look', label: 'Look', Icon: SlidersHorizontal }]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Scene look" tab="look" startOpen keywords="adjustment layer whole scene grade warm cool night dreamy film" tip={t('Changes everything below it while it plays, then fades away.')}>
      <Chips label="One click" options={ADJUST_PRESETS.map(({ id, label }) => ({ id, label }))} value={preset} onPick={(id) => set(withPreset(span, ADJUST_PRESETS.find((entry) => entry.id === id)!))}/>
      <More>
        <Chips label="Look" options={LOOK_NAMES} value={span.look ?? 'none'} onPick={(look) => set({ look })}/>
        <ValueSlider label="Brightness" value={span.adjust.brightness} min={0.25} max={2} step={0.01} defaultValue={DEFAULT_ADJUST.brightness} unit="%" factor={100} onChange={tone('brightness')}/>
        <ValueSlider label="Contrast" value={span.adjust.contrast} min={0.25} max={2} step={0.01} defaultValue={DEFAULT_ADJUST.contrast} unit="%" factor={100} onChange={tone('contrast')}/>
        <ValueSlider label="Saturation" value={span.adjust.saturation} min={0} max={2} step={0.01} defaultValue={DEFAULT_ADJUST.saturation} unit="%" factor={100} onChange={tone('saturation')}/>
        <ValueSlider label="Warmth" value={span.adjust.temperature} min={0.7} max={1.4} step={0.01} defaultValue={DEFAULT_ADJUST.temperature} unit="%" factor={100} onChange={tone('temperature')}/>
        <ValueSlider label="Soft glow" value={span.dreamy_glow?.intensity ?? 0} min={0} max={1} step={0.01} defaultValue={0} unit="%" factor={100}
          onChange={(intensity, group) => set({ dreamy_glow: intensity > 0 ? { softness: 0.6, warmth: 0.5, ...span.dreamy_glow, intensity } : null }, group)}/>
        <ValueSlider label="Fade in" value={span.fade_in} min={0} max={5} step={0.1} defaultValue={0.5} unit="s" decimals={1} onChange={(fade_in, group) => set({ fade_in }, group)}/>
        <ValueSlider label="Fade out" value={span.fade_out} min={0} max={5} step={0.1} defaultValue={0.5} unit="s" decimals={1} onChange={(fade_out, group) => set({ fade_out }, group)}/>
      </More>
    </Group>
    <ColourWheelsGroup wheels={span.wheels} onChange={(wheels, group) => set({ wheels }, group)}/>
  </Panel>;
}
