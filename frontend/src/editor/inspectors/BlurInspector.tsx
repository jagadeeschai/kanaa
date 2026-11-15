import { useEditorPanel } from '../state/EditorContext';
import { Chips } from "./parts";
import { Move, EyeOff } from "lucide-react";
import { DEFAULT_BLUR, type BlurBox } from "../../timeline/model";
import { ValueSlider, type TimeFieldProps } from "../controls";
import { Timing, timingSummary } from "../Timing";
import { Group, More, Panel } from "../layout";
import { MotionPanel } from "../Keyframes";

export type BlurInspectorBindings = { blur: BlurBox; timing: TimeFieldProps[]; local: number; onChange: (changes: Partial<BlurBox>, group?: string) => void; onSeekLocal: (t: number) => void; onPause: () => void; follow: React.ReactNode };

export function BlurInspector() {
  const { blur, timing, local, onChange, onSeekLocal, onPause, follow } = useEditorPanel<BlurInspectorBindings>('blur');
  return <Panel id="blur" tabs={[{ id: 'hide', label: 'Hide', Icon: EyeOff }, { id: 'motion', label: 'Motion', Icon: Move, changed: Object.keys(blur.transform.keyframes ?? {}).length > 0 }]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Hide" tab="hide" startOpen keywords="hide face number plate pixelate censor blur strength oval box" tip="Hide a face or number plate. Drag the box in the preview to move it." help="hide-faces-plates">
      <Chips label="Style" options={[{ id: 'blur' as const, label: 'Blur' }, { id: 'pixelate' as const, label: 'Pixelate' }]} value={blur.style} onPick={(style) => onChange({ style })}/>
      <Chips label="Shape" options={[{ id: 'oval' as const, label: 'Oval' }, { id: 'box' as const, label: 'Box' }]} value={blur.shape} onPick={(shape) => onChange({ shape })}/>
      <ValueSlider label="Strength" value={blur.amount} min={0.05} max={1} step={0.01} defaultValue={DEFAULT_BLUR.amount} unit="%" factor={100} onChange={(amount, group) => onChange({ amount }, group)}/>
      <More>
      <ValueSlider label="Width" value={blur.width} min={0.02} max={1} step={0.005} defaultValue={DEFAULT_BLUR.width} unit="%" factor={100} decimals={1} onChange={(width, group) => onChange({ width }, group)}/>
      <ValueSlider label="Height" value={blur.height} min={0.02} max={1} step={0.005} defaultValue={DEFAULT_BLUR.height} unit="%" factor={100} decimals={1} onChange={(height, group) => onChange({ height }, group)}/>
      </More>
    </Group>
    <Group title="Follow movement" tab="hide" startOpen keywords="track follow stick moving person face plate" tip="Put the blur on a face, click Follow, and it stays on the face." help="follow-movement">{follow}</Group>
    <Group title="Moves" tab="motion" keywords="move position size animate keyframe" help="animations-and-moves" changed={Object.keys(blur.transform.keyframes ?? {}).length > 0}>
      <MotionPanel transform={blur.transform} local={local} length={blur.length} controls={['position', 'scale']} onChange={(transform, group) => onChange({ transform }, group)} onSeek={onSeekLocal} onGestureStart={onPause}/>
    </Group>
  </Panel>;
}
