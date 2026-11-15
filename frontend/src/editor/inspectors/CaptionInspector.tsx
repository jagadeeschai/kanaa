import { useEditorPanel } from '../state/EditorContext';
import { Chips } from "./parts";
import { useEffect, useState } from "react";
import { Captions, Trash2, ALargeSmall } from "lucide-react";
import { captionText, type Caption, type CaptionLayer, type CaptionLook } from "../../timeline/model";
import { ValueSlider, type TimeFieldProps } from "../controls";
import { Timing, timingSummary } from "../Timing";
import { Group, More, Panel } from "../layout";

export type CaptionInspectorBindings = { caption: Caption; layer: CaptionLayer; timing: TimeFieldProps[]; onText: (text: string) => void; onLook: (changes: Partial<CaptionLook>, group?: string) => void; onRemoveAll: () => void };

export function CaptionInspector() {
  const { caption, layer, timing, onText, onLook, onRemoveAll } = useEditorPanel<CaptionInspectorBindings>('caption');
  const [draft, setDraft] = useState(captionText(caption));
  useEffect(() => setDraft(captionText(caption)), [caption.id]);
  return <Panel id="caption" tabs={[{ id: 'words', label: 'Words', Icon: Captions }, { id: 'style', label: 'Style', Icon: ALargeSmall }]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration" help="timing-and-trimming">
      <Timing fields={timing}/>
    </Group>
    <Group title="This caption" tab="words" startOpen keywords="subtitles captions words fix spelling text" tip="Fix a word by typing. Keep the same number of words to keep its timing." help="captions">
      <textarea className="ed-text" aria-label="Caption text" lang="ta" value={draft} maxLength={300} rows={2} onChange={(event) => { setDraft(event.target.value); if (event.target.value.trim()) onText(event.target.value); }}/>
    </Group>
    <Group title="All captions" tab="style" startOpen keywords="captions style size position colour highlight karaoke remove" tip="Changes every caption at once." help="captions">
      <Chips label="Caption style" options={[{ id: 'outline' as const, label: 'Outline' }, { id: 'shadow' as const, label: 'Shadow' }, { id: 'band' as const, label: 'Band' }]} value={layer.style} onPick={(style) => onLook({ style })}/>
      <ValueSlider label="Size" value={layer.size} min={20} max={100} step={1} defaultValue={48} onChange={(size, group) => onLook({ size: Math.round(size) }, group)}/>
      <Chips label="Caption position" options={[{ id: 'top' as const, label: 'Top' }, { id: 'center' as const, label: 'Middle' }, { id: 'bottom' as const, label: 'Bottom' }]} value={layer.position} onPick={(position) => onLook({ position })}/>
      <More>
      <label className="ed-color"><span>Colour</span><input type="color" aria-label="Caption colour" value={layer.color} onChange={(event) => onLook({ color: event.target.value }, `caption-colour-${layer.id}`)}/></label>
      <label className="ed-check"><input type="checkbox" checked={Boolean(layer.highlight)} onChange={(event) => onLook({ highlight: event.target.checked ? '#ffd400' : null })}/><span>Light up each word as it's spoken</span></label>
      {layer.highlight && <label className="ed-color"><span>Highlight colour</span><input type="color" aria-label="Lit word colour" value={layer.highlight} onChange={(event) => onLook({ highlight: event.target.value }, `caption-lit-${layer.id}`)}/></label>}
      <button className="ed-button wide" onClick={onRemoveAll}><Trash2 size={14}/>Remove all captions</button>
      </More>
    </Group>
  </Panel>;
}
