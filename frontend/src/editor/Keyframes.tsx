import { useRef } from 'react';
import { ValueSlider } from './controls';
import { ChevronLeft, ChevronRight, Diamond, Timer } from 'lucide-react';
import { valueAt, type AnimatedProperty, type Ease, type Transform } from '../timeline/evaluate';
import { addKey, hasKeyAt, isAnimated, keyTimes, moveKey, removeKey, setEase, toggleAnimated, writeValue, type Control } from '../timeline/keyframes';

const SAMPLES_PER_SECOND = 30;
const EASES: { id: Ease; label: string }[] = [{ id: 'easeInOut', label: 'Smooth' }, { id: 'easeOut', label: 'Slow down' }, { id: 'linear', label: 'Steady' }];
const SLIDERS: Record<Exclude<Control, 'position'>, { label: string; property: AnimatedProperty; min: number; max: number; step: number; rest: number; unit: string; factor: number }> = {
  scale: { label: 'Size', property: 'scale', min: 0.05, max: 8, step: 0.01, rest: 1, unit: '%', factor: 100 },
  rotation: { label: 'Tilt', property: 'rotation', min: -360, max: 360, step: 1, rest: 0, unit: '°', factor: 1 },
  opacity: { label: 'See-through', property: 'opacity', min: 0, max: 1, step: 0.01, rest: 1, unit: '%', factor: 100 },
};
const LABELS: Record<Control, string> = { position: 'Position', scale: 'Size', rotation: 'Tilt', opacity: 'See-through' };

type PanelProps = { transform: Transform; local: number; length: number; onChange: (transform: Transform, group?: string) => void; onSeek: (t: number) => void; onGestureStart: () => void; controls?: Control[] };

function Stopwatch({ control, transform, local, length, onChange, onSeek }: PanelProps & { control: Control }) {
  const animated = isAnimated(transform, control);
  const times = keyTimes(transform, control).filter((t) => t <= length);
  const here = hasKeyAt(transform, control, local);
  const before = [...times].reverse().find((t) => t < local - 0.01);
  const after = times.find((t) => t > local + 0.01);
  const name = LABELS[control];
  return <div className="ed-key-tools">
    {animated && <>
      <button className="ed-icon small" disabled={before === undefined} aria-label={`Previous ${name} point`} title="Previous point" onClick={() => onSeek(before!)}><ChevronLeft size={14}/></button>
      <button className={`ed-icon small ${here ? 'on' : ''}`} aria-pressed={here} aria-label={`${here ? 'Remove' : 'Add'} ${name} point here`} title={here ? 'Remove this point' : 'Add a point here'} onClick={() => onChange((here ? removeKey : addKey)(transform, control, local))}><Diamond size={13}/></button>
      <button className="ed-icon small" disabled={after === undefined} aria-label={`Next ${name} point`} title="Next point" onClick={() => onSeek(after!)}><ChevronRight size={14}/></button>
    </>}
    <button className={`ed-icon small ${animated ? 'on' : ''}`} aria-pressed={animated} aria-label={`Animate ${name}`} title={animated ? 'Stop animating and keep this value' : 'Animate: each change adds a point'} onClick={() => onChange(toggleAnimated(transform, control, local))}><Timer size={14}/></button>
  </div>;
}

export function MotionPanel(props: PanelProps) {
  const { transform, local, onChange, onGestureStart, controls = ['position', 'scale', 'rotation', 'opacity'] } = props;
  const animated = (['position', 'scale', 'rotation', 'opacity'] as Control[]).filter((control) => isAnimated(transform, control));
  const ease = animated.length ? transform.keyframes?.[animated[0] === 'position' ? 'x' : animated[0] as AnimatedProperty]?.[0]?.ease ?? 'easeInOut' : null;
  return <>
    <div className="ed-motion"><span>Position</span><Stopwatch {...props} control="position"/></div>
    {isAnimated(transform, 'position') && <p className="ed-tip">Move the playhead, then drag the picture. Each spot becomes a point.</p>}
    {(Object.keys(SLIDERS) as Exclude<Control, 'position'>[]).filter((control) => controls.includes(control)).map((control) => {
      const slider = SLIDERS[control];
      const value = valueAt(transform, slider.property, local);
      return <ValueSlider key={control} label={slider.label} value={value} min={slider.min} max={slider.max} step={slider.step} defaultValue={slider.rest} unit={slider.unit} factor={slider.factor} onGestureStart={onGestureStart}
        onChange={(next, group) => onChange(writeValue(transform, slider.property, local, next), group)} actions={<Stopwatch {...props} control={control}/>}/>;
    })}
    {ease && <div className="ed-chips" role="group" aria-label="Motion style">{EASES.map((option) => <button key={option.id} className={ease === option.id ? 'on' : ''} aria-pressed={ease === option.id} onClick={() => onChange(animated.reduce((next, control) => setEase(next, control, option.id), transform))}>{option.label}</button>)}</div>}
  </>;
}

/** The route the picture takes, with keyframes to drag. */
export function MotionPath({ transform, length, onChange, onSeek }: { transform: Transform; length: number; onChange: (transform: Transform, group?: string) => void; onSeek: (t: number) => void }) {
  const box = useRef<SVGSVGElement>(null);
  const drag = useRef<{ t: number; group: string } | null>(null);
  // One key is not a route yet, and its dot would sit under the picture and catch the drag meant for it.
  if (keyTimes(transform, 'position').length < 2) return null;
  const samples = Math.ceil(length * SAMPLES_PER_SECOND);
  const points = Array.from({ length: samples + 1 }, (_, index) => { const t = (index / samples) * length; return `${valueAt(transform, 'x', t)},${valueAt(transform, 'y', t)}`; }).join(' ');
  const move = (event: React.PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!drag.current || !rect) return;
    onChange(moveKey(transform, drag.current.t, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height), drag.current.group);
  };
  return <svg ref={box} className="ed-path" aria-label="Motion path">
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" width="100%" height="100%"><polyline points={points} vectorEffect="non-scaling-stroke"/></svg>
    {keyTimes(transform, 'position').filter((t) => t <= length).map((t) => <circle key={t} cx={`${valueAt(transform, 'x', t) * 100}%`} cy={`${valueAt(transform, 'y', t) * 100}%`} r="7" role="button" aria-label={`Keyframe at ${t.toFixed(2)} seconds`}
      onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { t, group: `path-${Date.now()}` }; onSeek(t); }} onPointerMove={move} onPointerUp={() => { drag.current = null; }}/>)}
  </svg>;
}
