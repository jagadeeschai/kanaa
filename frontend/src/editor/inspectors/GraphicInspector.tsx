import { Circle, MoveRight } from 'lucide-react';
import { t } from '../../i18n';
import type { GraphicKind, GraphicStyle, TextItem } from '../../timeline/model';
import { Timing, timingSummary } from '../Timing';
import type { TimeFieldProps } from '../controls';
import { ValueSlider } from '../controls';
import { Group, Panel } from '../layout';
import { AnimationPicker, Chips } from './parts';
import { useEffect, useState } from 'react';

const KINDS: { id: GraphicKind; label: string }[] = [
  { id: 'arrow-straight', label: 'Straight arrow' }, { id: 'arrow-curved', label: 'Curved arrow' },
  { id: 'circle', label: 'Circle' }, { id: 'box', label: 'Rounded box' }, { id: 'callout', label: 'Callout label' }, { id: 'spotlight', label: 'Spotlight' },
];
const STYLES: { id: GraphicStyle; label: string }[] = [
  { id: 'clean', label: 'Clean white' }, { id: 'hand-drawn', label: 'Hand-drawn' },
  { id: 'neon', label: 'Neon' }, { id: 'documentary', label: 'Documentary yellow' },
];
const ENTRANCES = [{ id: 'reveal' as const, label: 'Draw on' }, { id: 'pop' as const, label: 'Pop' }, { id: 'fade' as const, label: 'Fade' }];

export function GraphicInspector({ text, timing, onChange, onEnter, follow }: { text: TextItem; timing: TimeFieldProps[]; onChange: (changes: Partial<TextItem>, group?: string) => void; onEnter: () => void; follow?: React.ReactNode }) {
  const graphic = text.graphic!;
  const [draft, setDraft] = useState(text.text);
  useEffect(() => setDraft(text.text), [text.id, text.text]);
  const setStyle = (style: GraphicStyle) => onChange({ graphic: { ...graphic, style } });
  return <Panel id="graphic" tabs={[{ id: 'look', label: 'Graphic', Icon: Circle }, { id: 'motion', label: 'Motion', Icon: MoveRight, changed: Boolean(text.enter) }]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Graphic" tab="look" startOpen keywords="arrow circle box callout label pointer explainer" tip="The point you right-clicked is the arrow tip or the centre of the highlight. A glow outline traces what you right-clicked.">
      {graphic.kind !== 'outline' && <Chips label="Kind" options={KINDS} value={graphic.kind} onPick={(kind) => onChange({ text: kind === 'callout' && !text.text.trim() ? 'Type your label' : text.text, graphic: { ...graphic, kind } })}/>}
      {graphic.kind === 'callout' && (
        <textarea className="ed-text" aria-label={t('Callout label')} lang="ta" value={draft} maxLength={200} rows={2}
          onChange={(event) => { setDraft(event.target.value); if (event.target.value.trim()) onChange({ text: event.target.value }, `graphic-text-${text.id}`); }} onBlur={() => { if (!draft.trim()) setDraft(text.text); }}/>
      )}
      <Chips label="Style" options={STYLES} value={graphic.style} onPick={setStyle}/>
      <label className="ed-color"><span>{t('Colour')}</span><input type="color" aria-label="Graphic colour" value={text.color} onChange={(event) => onChange({ color: event.target.value }, `graphic-colour-${text.id}`)}/></label>
      <ValueSlider label="Line width" value={graphic.line_width} min={.001} max={.025} step={.001} defaultValue={.006} unit="%" factor={100} decimals={1} onChange={(line_width, group) => onChange({ graphic: { ...graphic, line_width } }, group)}/>
      {graphic.kind === 'spotlight' && <ValueSlider label="Darken the rest" value={graphic.dim ?? .6} min={.1} max={.95} step={.05} defaultValue={.6} unit="%" factor={100} onChange={(dim, group) => onChange({ graphic: { ...graphic, dim } }, group)}/>}
      {(graphic.kind === 'circle' || graphic.kind === 'box' || graphic.kind === 'spotlight') && <><ValueSlider label="Width" value={graphic.width} min={.05} max={.9} step={.01} defaultValue={.25} unit="%" factor={100} onChange={(width, group) => onChange({ graphic: { ...graphic, width } }, group)}/><ValueSlider label="Height" value={graphic.height} min={.05} max={.9} step={.01} defaultValue={.18} unit="%" factor={100} onChange={(height, group) => onChange({ graphic: { ...graphic, height } }, group)}/></>}
    </Group>
    {graphic.kind === 'spotlight' ? <p className="ed-tip">{t('A spotlight stays where you put it. To light something that moves, use a glow outline or a circle and choose Follow.')}</p> : follow}
    <Group title="Entrance" tab="motion" startOpen changed={Boolean(text.enter)} keywords="draw on pop fade animation entrance">
      <AnimationPicker label="Enter" presets={ENTRANCES} value={text.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onEnter}/>
    </Group>
  </Panel>;
}
