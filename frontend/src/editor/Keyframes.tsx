import { useContext, useRef } from 'react';
import { SimpleContext } from './layout';
import { ValueSlider } from './controls';
import { ChevronLeft, ChevronRight, Minus, Plus, Timer } from 'lucide-react';
import { valueAt, type AnimatedProperty, type Ease, type Transform } from '../timeline/evaluate';
import { addKey, hasKeyAt, isAnimated, isFollowed, keyTimes, moveKey, removeKey, setEase, toggleAnimated, writeValue, type Control } from '../timeline/keyframes';

const SAMPLES_PER_SECOND = 30;
const EASES: { id: Ease; label: string }[] = [{ id: 'easeInOut', label: 'Smooth' }, { id: 'easeOut', label: 'Slow down' }, { id: 'linear', label: 'Steady' }];
const SLIDERS: Record<Exclude<Control, 'position'>, { label: string; property: AnimatedProperty; min: number; max: number; step: number; rest: number; unit: string; factor: number }> = {
  scale: { label: 'Size', property: 'scale', min: 0.05, max: 8, step: 0.01, rest: 1, unit: '%', factor: 100 },
  rotation: { label: 'Tilt', property: 'rotation', min: -360, max: 360, step: 1, rest: 0, unit: '°', factor: 1 },
  opacity: { label: 'See-through', property: 'opacity', min: 0, max: 1, step: 0.01, rest: 1, unit: '%', factor: 100 },
};
const LABELS: Record<Control, string> = { position: 'Position', scale: 'Size', rotation: 'Tilt', opacity: 'See-through' };

type PanelProps = { transform: Transform; local: number; length: number; onChange: (transform: Transform, group?: string) => void; onSeek: (t: number) => void; onGestureStart: () => void; controls?: Control[] };

/** Turns animation on or off for one setting, in words: "Animate", or "Animating" when it moves. */
function AnimateToggle({ control, transform, local, onChange }: PanelProps & { control: Control }) {
  const animated = isAnimated(transform, control);
  const name = LABELS[control];
  return <button className={`ed-animate ${animated ? 'on' : ''}`} aria-pressed={animated} aria-label={`${animated ? 'Stop animating' : 'Animate'} ${name}`}
    title={animated ? 'Stop animating: removes its points and keeps the value it has now' : `Make ${name.toLowerCase()} change over time: each change you make at a new moment adds a point`}
    onClick={() => onChange(toggleAnimated(transform, control, local))}><Timer size={12}/>{animated ? 'Animating' : 'Animate'}</button>;
}

/** Under an animated setting: how many points it has, and buttons to step between them or add and remove one here. */
function PointBar({ control, transform, local, length, onChange, onSeek }: PanelProps & { control: Control }) {
  if (!isAnimated(transform, control)) return null;
  const times = keyTimes(transform, control).filter((t) => t <= length);
  const here = hasKeyAt(transform, control, local);
  const before = [...times].reverse().find((t) => t < local - 0.01);
  const after = times.find((t) => t > local + 0.01);
  const name = LABELS[control];
  return <div className="ed-points" role="group" aria-label={`${name} points`}>
    <span className="ed-points-count">{times.length} {times.length === 1 ? 'point' : 'points'}</span>
    <button disabled={before === undefined} aria-label={`Go to the previous ${name} point`} title="Go to the previous point" onClick={() => onSeek(before!)}><ChevronLeft size={13}/>Previous</button>
    <button className={here ? 'remove' : 'add'} aria-label={`${here ? 'Remove the' : 'Add a'} ${name} point here`} onClick={() => onChange((here ? removeKey : addKey)(transform, control, local))}>{here ? <><Minus size={12}/>Remove point</> : <><Plus size={12}/>Add point</>}</button>
    <button disabled={after === undefined} aria-label={`Go to the next ${name} point`} title="Go to the next point" onClick={() => onSeek(after!)}>Next<ChevronRight size={13}/></button>
  </div>;
}

/** Keyframes are a Pro control: Simple mode hides them (moves, animations and Follow still work). */
export function MotionPanel(props: PanelProps) {
  return useContext(SimpleContext) ? null : <KeyframePanel {...props}/>;
}

function KeyframePanel(props: PanelProps) {
  const { transform, local, onChange, onGestureStart, controls = ['position', 'scale', 'rotation', 'opacity'] } = props;
  const animated = (['position', 'scale', 'rotation', 'opacity'] as Control[]).filter((control) => isAnimated(transform, control));
  const ease = animated.length ? transform.keyframes?.[animated[0] === 'position' ? 'x' : animated[0] as AnimatedProperty]?.[0]?.ease ?? 'easeInOut' : null;
  return <>
    <div className="ed-motion"><span>Position</span><AnimateToggle {...props} control="position"/></div>
    <PointBar {...props} control="position"/>
    {isAnimated(transform, 'position') && <p className="ed-tip">Move the playhead, then drag the picture. Each spot becomes a point.</p>}
    {!animated.length && <p className="ed-tip">Press Animate beside a value, move the playhead, change it — Kanaa tweens between points.</p>}
    {(Object.keys(SLIDERS) as Exclude<Control, 'position'>[]).filter((control) => controls.includes(control)).map((control) => {
      const slider = SLIDERS[control];
      const value = valueAt(transform, slider.property, local);
      return <div key={control}><ValueSlider label={slider.label} value={value} min={slider.min} max={slider.max} step={slider.step} defaultValue={slider.rest} unit={slider.unit} factor={slider.factor} onGestureStart={onGestureStart}
        onChange={(next, group) => onChange(writeValue(transform, slider.property, local, next), group)} actions={<AnimateToggle {...props} control={control}/>}/><PointBar {...props} control={control}/></div>;
    })}
    {ease && <span className="ed-who-title">How it moves between points</span>}
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
    {/* A followed path has a key on every frame; its dots would bury the picture, so only the line shows. */}
    {!isFollowed(transform) && keyTimes(transform, 'position').filter((t) => t <= length).map((t) => <circle key={t} cx={`${valueAt(transform, 'x', t) * 100}%`} cy={`${valueAt(transform, 'y', t) * 100}%`} r="7" role="button" aria-label={`Keyframe at ${t.toFixed(2)} seconds`}
      onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { t, group: `path-${Date.now()}` }; onSeek(t); }} onPointerMove={move} onPointerUp={() => { drag.current = null; }}/>)}
  </svg>;
}
