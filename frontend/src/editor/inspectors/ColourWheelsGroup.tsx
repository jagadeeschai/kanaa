/** Colour wheels: one-click grades first; under More, a puck per range (drag toward a colour) and its brightness. */
import { useRef } from 'react';
import { FLAT_WHEELS, WHEEL_PRESETS, wheelVectors, type ColourWheels, type Wheel } from '../../timeline/colourWheels';
import { ValueSlider } from '../controls';
import { Group, More } from '../layout';
import { Chips } from './parts';
import { t } from '../../i18n';

const SIZE = 64;
const RANGES: { id: keyof ColourWheels; label: string }[] = [{ id: 'shadows', label: 'Shadows' }, { id: 'midtones', label: 'Midtones' }, { id: 'highlights', label: 'Highlights' }];
const same = (a: ColourWheels | null | undefined, b: ColourWheels | null) => JSON.stringify(wheelVectors(a)) === JSON.stringify(wheelVectors(b));

/** A colour circle; the puck's angle is the hue and its distance from the middle the amount. Double-click resets. */
function Puck({ wheel, label, onChange }: { wheel: Wheel; label: string; onChange: (wheel: Wheel, group?: string) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const group = useRef('');
  const pick = (event: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2); const dy = (box.top + box.height / 2) - event.clientY;
    const amount = Math.min(1, Math.hypot(dx, dy) / (box.width / 2));
    const hue = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
    onChange({ ...wheel, hue, amount: Math.round(amount * 100) / 100 }, group.current);
  };
  const angle = (wheel.hue * Math.PI) / 180; const r = (wheel.amount * SIZE) / 2;
  return <div className="ed-wheel">
    <svg ref={ref} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="slider" aria-label={t(label)} aria-valuetext={`${wheel.hue}° ${Math.round(wheel.amount * 100)}%`}
      onPointerDown={(event) => { group.current = `wheel-${label}-${Date.now()}`; event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
      onPointerMove={(event) => { if (event.buttons) pick(event); }} onDoubleClick={() => onChange({ ...wheel, amount: 0 })}>
      <circle cx={SIZE / 2 + Math.cos(angle) * r} cy={SIZE / 2 - Math.sin(angle) * r} r={5} fill="none" stroke="white" strokeWidth={2}/>
    </svg>
    <span>{t(label)}</span>
  </div>;
}

export function ColourWheelsGroup({ wheels, onChange }: { wheels: ColourWheels | null | undefined; onChange: (wheels: ColourWheels | null, group?: string) => void }) {
  const current = wheels ?? FLAT_WHEELS;
  const preset = WHEEL_PRESETS.find((entry) => entry.wheels && same(wheels, entry.wheels))?.id ?? (wheelVectors(wheels) ? null : 'reset');
  const set = (range: keyof ColourWheels, wheel: Wheel, group?: string) => onChange({ ...current, [range]: wheel }, group);
  return <Group title="Colour wheels" tab="look" startOpen={Boolean(wheelVectors(wheels))} changed={Boolean(wheelVectors(wheels))} keywords="colour wheels lift gamma gain shadows midtones highlights grade teal orange golden"
    tip="Tint the dark, middle and bright parts of the picture. Pick a grade, or drag a wheel toward a colour under More.">
    <Chips label="Grade" options={WHEEL_PRESETS.map(({ id, label }) => ({ id, label }))} value={preset} onPick={(id) => onChange(WHEEL_PRESETS.find((entry) => entry.id === id)!.wheels)}/>
    <More>
      <div className="ed-wheels">{RANGES.map(({ id, label }) => <Puck key={id} label={label} wheel={current[id]} onChange={(wheel, group) => set(id, wheel, group)}/>)}</div>
      {RANGES.map(({ id, label }) => <ValueSlider key={id} label={`${label} brightness`} value={current[id].brightness} min={-1} max={1} step={0.01} defaultValue={0} unit="%" factor={100}
        onChange={(brightness, group) => set(id, { ...current[id], brightness }, group)}/>)}
    </More>
  </Group>;
}
