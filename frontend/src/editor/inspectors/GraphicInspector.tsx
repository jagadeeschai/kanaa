import { Circle, MoveRight } from 'lucide-react';
import { t } from '../../i18n';
import type { GraphicKind, GraphicStyle, TextItem } from '../../timeline/model';
import { Timing, timingSummary } from '../Timing';
import type { TimeFieldProps } from '../controls';
import { ValueSlider } from '../controls';
import { Group, More, Panel } from '../layout';
import { AnimationPicker, Chips } from './parts';
import { useEffect, useState } from 'react';
import { chartDataText, parseChartData } from '../../timeline/chart-data';
import { SequenceGraphicFields } from './SequenceGraphicFields';
import { TimelineGraphicFields } from './TimelineGraphicFields';

const KINDS: { id: GraphicKind; label: string }[] = [
  { id: 'arrow-straight', label: 'Straight arrow' }, { id: 'arrow-curved', label: 'Curved arrow' },
  { id: 'circle', label: 'Circle' }, { id: 'box', label: 'Rounded box' }, { id: 'callout', label: 'Callout label' }, { id: 'spotlight', label: 'Spotlight' },
  { id: 'lower-third', label: 'Lower third' },
  { id: 'count-up', label: 'Count-up number' },
  { id: 'chapter-card', label: 'Chapter card' },
  { id: 'bar-chart', label: 'Bar chart' },
  { id: 'line-chart', label: 'Line chart' },
  { id: 'pie-chart', label: 'Pie or donut chart' },
  { id: 'step-list', label: 'Step list' },
  { id: 'timeline-bar', label: 'Timeline bar' },
];
const STYLES: { id: GraphicStyle; label: string }[] = [
  { id: 'clean', label: 'Clean white' }, { id: 'hand-drawn', label: 'Hand-drawn' },
  { id: 'neon', label: 'Neon' }, { id: 'documentary', label: 'Documentary yellow' },
];
const LOWER_STYLES: { id: GraphicStyle; label: string }[] = [
  { id: 'clean', label: 'Clean white' }, { id: 'documentary', label: 'Documentary yellow' },
  { id: 'dark-band', label: 'Dark band' }, { id: 'bold-colour', label: 'Bold colour' },
];
const CARD_MODES = [{ id: 'full' as const, label: 'Full frame' }, { id: 'corner' as const, label: 'Corner card' }];
const BAR_ORIENTATIONS = [{ id: 'horizontal' as const, label: 'Horizontal' }, { id: 'vertical' as const, label: 'Vertical' }];
const PIE_KINDS = [{ id: 'pie', label: 'Pie' }, { id: 'donut', label: 'Donut' }];
const ENTRANCES = [{ id: 'reveal' as const, label: 'Draw on' }, { id: 'pop' as const, label: 'Pop' }, { id: 'fade' as const, label: 'Fade' }];

export function GraphicInspector({ text, timing, onChange, onEnter, follow }: { text: TextItem; timing: TimeFieldProps[]; onChange: (changes: Partial<TextItem>, group?: string) => void; onEnter: () => void; follow?: React.ReactNode }) {
  const graphic = text.graphic!;
  const sequence = graphic.kind === 'step-list' || graphic.kind === 'timeline-bar';
  const [draft, setDraft] = useState(text.text);
  const [dataDraft, setDataDraft] = useState(chartDataText(graphic.data));
  const [dataError, setDataError] = useState('');
  const chartLimit = graphic.kind === 'bar-chart' ? 8 : graphic.kind === 'line-chart' ? 12 : 6;
  useEffect(() => setDraft(text.text), [text.id, text.text]);
  // Only replace what is being typed when the data changed some other way (another item, undo); a half-typed row or
  // "2,00" must stay as typed.
  useEffect(() => setDataDraft((typed) => JSON.stringify(parseChartData(typed, 99).rows ?? null) === JSON.stringify(graphic.data ?? null) ? typed : chartDataText(graphic.data)), [text.id, graphic.data]);
  useEffect(() => setDataError(''), [text.id]);
  const setStyle = (style: GraphicStyle) => onChange({ graphic: { ...graphic, style } });
  return <Panel id="graphic" tabs={[{ id: 'look', label: 'Graphic', Icon: Circle }, { id: 'motion', label: 'Motion', Icon: MoveRight, changed: Boolean(text.enter) }]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Graphic" tab="look" startOpen keywords="arrow circle box callout label pointer explainer" tip="The point you right-clicked is the arrow tip or the centre of the highlight. A glow outline traces what you right-clicked.">
      {graphic.kind !== 'outline' && <Chips label="Kind" options={KINDS} value={graphic.kind} onPick={(kind) => onChange({ text: kind === 'callout' && !text.text.trim() ? 'Type your label' : text.text, graphic: { ...graphic, kind, ...(kind === 'step-list' && !graphic.steps ? { steps: ['திட்டமிடுங்கள்', 'உருவாக்குங்கள்', 'பகிருங்கள்'], step_times: null, width: .78, height: .78 } : {}), ...(kind === 'timeline-bar' && !graphic.points ? { points: [{ date:'1947',label:'விடுதலை' },{date:'இன்று',label:'புதிய தொடக்கம்'}], width:.84,height:.64 } : {}) } })}/>}
      {sequence && <>{graphic.kind === 'step-list' ? <SequenceGraphicFields key={text.id} text={text} onChange={onChange}/> : <TimelineGraphicFields key={text.id} text={text} onChange={onChange}/>}<ValueSlider label="Text size" value={text.size} min={20} max={100} step={1} defaultValue={44} onChange={(size, group) => onChange({ size }, group)}/><Chips label="Style" options={LOWER_STYLES} value={graphic.style} onPick={setStyle}/><More><ValueSlider label="Width" value={graphic.width} min={.3} max={.95} step={.01} defaultValue={.78} onChange={(width,group)=>onChange({graphic:{...graphic,width}},group)}/><ValueSlider label="Height" value={graphic.height} min={.3} max={.95} step={.01} defaultValue={.78} onChange={(height,group)=>onChange({graphic:{...graphic,height}},group)}/></More><AnimationPicker label="Exit" presets={ENTRANCES} value={text.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onEnter}/></>}
      {graphic.kind === 'callout' && (
        <textarea className="ed-text" aria-label={t('Callout label')} lang="ta" value={draft} maxLength={200} rows={2}
          onChange={(event) => { setDraft(event.target.value); if (event.target.value.trim()) onChange({ text: event.target.value }, `graphic-text-${text.id}`); }} onBlur={() => { if (!draft.trim()) setDraft(text.text); }}/>
      )}
      {graphic.kind === 'lower-third' && <><label className="ed-field"><span>{t('Name')}</span><input value={text.text} maxLength={120} onChange={(event) => event.target.value.trim() && onChange({ text: event.target.value }, `graphic-name-${text.id}`)}/></label><label className="ed-field"><span>{t('Role')}</span><input value={graphic.role ?? ''} maxLength={160} onChange={(event) => onChange({ graphic: { ...graphic, role: event.target.value } }, `graphic-role-${text.id}`)}/></label></>}
      {graphic.kind === 'count-up' && <><label className="ed-field"><span>{t('From')}</span><input type="number" value={graphic.count_from ?? 0} onChange={(event) => onChange({ graphic: { ...graphic, count_from: Number(event.target.value) } }, `graphic-count-from-${text.id}`)}/></label><label className="ed-field"><span>{t('To')}</span><input type="number" value={graphic.count_to ?? 2000} onChange={(event) => onChange({ graphic: { ...graphic, count_to: Number(event.target.value) } }, `graphic-count-to-${text.id}`)}/></label><label className="ed-field"><span>{t('Label')}</span><input value={graphic.label ?? ''} maxLength={120} onChange={(event) => onChange({ graphic: { ...graphic, label: event.target.value } }, `graphic-count-label-${text.id}`)}/></label><More><label className="ed-field"><span>{t('Prefix')}</span><input value={graphic.prefix ?? ''} maxLength={20} onChange={(event) => onChange({ graphic: { ...graphic, prefix: event.target.value } })}/></label><label className="ed-field"><span>{t('Suffix')}</span><input value={graphic.suffix ?? ''} maxLength={20} onChange={(event) => onChange({ graphic: { ...graphic, suffix: event.target.value } })}/></label><label className="ed-check"><input type="checkbox" checked={graphic.indian_grouping ?? false} onChange={(event) => onChange({ graphic: { ...graphic, indian_grouping: event.target.checked } })}/>{t('Indian grouping')}</label><label className="ed-check"><input type="checkbox" checked={graphic.tamil_numerals ?? false} onChange={(event) => onChange({ graphic: { ...graphic, tamil_numerals: event.target.checked } })}/>{t('Tamil numerals')}</label></More></>}
      {graphic.kind === 'chapter-card' && <><label className="ed-field"><span>{t('Chapter title')}</span><input value={text.text} maxLength={200} onChange={(event) => event.target.value.trim() && onChange({ text: event.target.value }, `graphic-chapter-${text.id}`)}/></label><Chips label="Layout" options={CARD_MODES} value={graphic.card_mode ?? 'full'} onPick={(card_mode) => onChange({ graphic: { ...graphic, card_mode } })}/></>}
      {(graphic.kind === 'bar-chart' || graphic.kind === 'line-chart' || graphic.kind === 'pie-chart') && <><label><span>{t('Data')}</span><textarea className="ed-text" lang="ta" rows={6} value={dataDraft} placeholder={t('label, value')} onChange={(event) => { const value = event.target.value; setDataDraft(value); const parsed = parseChartData(value, chartLimit); setDataError(parsed.error ?? ''); if (parsed.rows) onChange({ graphic: { ...graphic, data: parsed.rows } }, `graphic-data-${text.id}`); }}/></label>{dataError && <p className="ed-error">{t(dataError)}</p>}{graphic.kind === 'bar-chart' && <Chips label="Direction" options={BAR_ORIENTATIONS} value={graphic.chart_orientation ?? 'horizontal'} onPick={(chart_orientation) => onChange({ graphic: { ...graphic, chart_orientation } })}/>} {graphic.kind === 'pie-chart' && <Chips label="Shape" options={PIE_KINDS} value={graphic.donut ? 'donut' : 'pie'} onPick={(shape) => onChange({ graphic: { ...graphic, donut: shape === 'donut' } })}/>}<More>{graphic.kind === 'bar-chart' && <label className="ed-field"><span>{t('Highlight bar')}</span><input type="number" min={0} max={graphic.data?.length ?? 1} value={(graphic.highlight_index ?? -1)+1 || ''} onChange={(event) => { const picked=Number(event.target.value)-1; onChange({ graphic: { ...graphic, highlight_index: picked >= 0 ? picked : null } }); }}/></label>}{graphic.kind !== 'pie-chart' && <label className="ed-check"><input type="checkbox" checked={graphic.indian_grouping ?? false} onChange={(event) => onChange({ graphic: { ...graphic, indian_grouping: event.target.checked } })}/>{t('Indian grouping')}</label>}<label className="ed-check"><input type="checkbox" checked={graphic.show_values ?? true} onChange={(event) => onChange({ graphic: { ...graphic, show_values: event.target.checked } })}/>{t(graphic.kind === 'line-chart' ? 'Show end value' : graphic.kind === 'pie-chart' ? 'Show percentages' : 'Show values')}</label></More></>}
      {(graphic.kind === 'lower-third' || graphic.kind === 'count-up' || graphic.kind === 'chapter-card' || graphic.kind === 'bar-chart' || graphic.kind === 'line-chart' || graphic.kind === 'pie-chart') && <ValueSlider label="Text size" value={text.size} min={20} max={100} step={1} defaultValue={44} onChange={(size, group) => onChange({ size }, group)}/>}
      {!sequence && <Chips label="Style" options={graphic.kind === 'lower-third' || graphic.kind === 'count-up' || graphic.kind === 'chapter-card' || graphic.kind === 'bar-chart' || graphic.kind === 'line-chart' || graphic.kind === 'pie-chart' ? LOWER_STYLES : STYLES} value={graphic.style} onPick={setStyle}/>}
      {graphic.kind !== 'pie-chart' && <label className="ed-color"><span>{t('Colour')}</span><input type="color" aria-label="Graphic colour" value={text.color} onChange={(event) => onChange({ color: event.target.value }, `graphic-colour-${text.id}`)}/></label>}
      <ValueSlider label="Line width" value={graphic.line_width} min={.001} max={.025} step={.001} defaultValue={.006} unit="%" factor={100} decimals={1} onChange={(line_width, group) => onChange({ graphic: { ...graphic, line_width } }, group)}/>
      {graphic.kind === 'spotlight' && <ValueSlider label="Darken the rest" value={graphic.dim ?? .6} min={.1} max={.95} step={.05} defaultValue={.6} unit="%" factor={100} onChange={(dim, group) => onChange({ graphic: { ...graphic, dim } }, group)}/>}
      {(graphic.kind === 'circle' || graphic.kind === 'box' || graphic.kind === 'spotlight' || graphic.kind === 'lower-third' || graphic.kind === 'bar-chart' || graphic.kind === 'line-chart' || graphic.kind === 'pie-chart' || (graphic.kind === 'chapter-card' && graphic.card_mode === 'corner')) && <><ValueSlider label="Width" value={graphic.width} min={.05} max={.9} step={.01} defaultValue={.25} unit="%" factor={100} onChange={(width, group) => onChange({ graphic: { ...graphic, width } }, group)}/><ValueSlider label="Height" value={graphic.height} min={.05} max={.9} step={.01} defaultValue={.18} unit="%" factor={100} onChange={(height, group) => onChange({ graphic: { ...graphic, height } }, group)}/></>}
    </Group>
    {graphic.kind === 'spotlight' ? <p className="ed-tip">{t('A spotlight stays where you put it. To light something that moves, use a glow outline or a circle and choose Follow.')}</p> : follow}
    <Group title="Entrance" tab="motion" startOpen changed={Boolean(text.enter)} keywords="draw on pop fade animation entrance">
      <AnimationPicker label="Enter" presets={ENTRANCES} value={text.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onEnter}/>
      {(graphic.kind === 'lower-third' || graphic.kind === 'count-up' || graphic.kind === 'chapter-card' || graphic.kind === 'bar-chart' || graphic.kind === 'line-chart' || graphic.kind === 'pie-chart') && <AnimationPicker label="Exit" presets={ENTRANCES} value={text.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onEnter}/>}
    </Group>
  </Panel>;
}
