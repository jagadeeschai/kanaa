import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { RotateCcw } from 'lucide-react';
import { formatTime, parseTime, parseValue, snapValue } from '../timeline/values';

let gestures = 0;
/** Each drag or key press is its own undo step. */
const nextGesture = () => { gestures += 1; return `gesture-${gestures}`; };

/** Commits or cancels a box that's being typed in, before any click elsewhere acts on old state. */
function useEditBox(editing: boolean, commit: () => void) {
  const input = useRef<HTMLInputElement>(null);
  // Enter, losing focus and a click elsewhere can all arrive for one edit. Only the first counts.
  const finished = useRef(false);
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => {
    if (!editing) return;
    finished.current = false;
    input.current?.select();
    const outside = (event: PointerEvent) => { if (event.target !== input.current) latest.current(); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [editing]);
  return { input, finished };
}

type SliderProps = { label: string; value: number; min: number; max: number; step: number; defaultValue: number; unit?: string; factor?: number; decimals?: number; onChange: (value: number, group?: string) => void; onGestureStart?: () => void; actions?: ReactNode };

export function ValueSlider({ label, value, min, max, step, defaultValue, unit = '', factor = 1, decimals = 0, onChange, onGestureStart, actions }: SliderProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const range = useRef<HTMLInputElement>(null);
  const group = useRef<string>();
  const shown = (value * factor).toFixed(decimals);
  const editing = draft !== null;
  const close = () => { setDraft(null); setInvalid(false); };
  const startGesture = () => { group.current = nextGesture(); onGestureStart?.(); };
  const save = (keepOpenIfBad: boolean) => {
    if (draft === null || box.finished.current) return;
    const next = parseValue(draft, factor, min, max, step);
    if (next === null && keepOpenIfBad) { setInvalid(true); return; }
    box.finished.current = true;
    close();
    if (next !== null && Math.abs(next - value) > 1e-9) { onGestureStart?.(); onChange(next); }
  };
  const box = useEditBox(editing, () => save(false));
  const open = () => { setDraft(shown); setInvalid(false); };
  const changed = Math.abs(value - defaultValue) >= step / 2;
  const nudge = (direction: number, size: number) => {
    const parsed = parseValue(draft ?? shown, factor, min, max, step) ?? value;
    setDraft((snapValue(parsed + direction * size, min, max, step) * factor).toFixed(decimals));
    setInvalid(false);
  };
  const percent = Math.min(100, Math.max(0, ((value - min) / (max - min || 1)) * 100));
  return <div className="ed-slider">
    <div className="ed-value-row">
      <span className="ed-value-label">{t(label)}</span>
      {editing ? <span className="ed-value-edit"><input ref={box.input} type="text" inputMode="decimal" aria-label={`${label} value`} aria-invalid={invalid} value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }} onBlur={() => save(false)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') { save(true); if (parseValue(draft, factor, min, max, step) !== null) range.current?.focus(); }
          else if (event.key === 'Escape') { box.finished.current = true; close(); range.current?.focus(); }
          else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); nudge(event.key === 'ArrowUp' ? 1 : -1, step * (event.shiftKey ? 10 : 1)); }
        }}/>{unit && <i>{unit}</i>}</span>
        : <button className="ed-value" title="Double-click to type a value" aria-label={`Edit ${label}, ${shown}${unit}`} onDoubleClick={open} onClick={(event) => { if (event.detail === 0) open(); }}>{shown}{unit}</button>}
      <button className="ed-icon small ed-reset" style={{ visibility: changed ? 'visible' : 'hidden' }} aria-label={`Reset ${label} to ${(defaultValue * factor).toFixed(decimals)}${unit}`} title={`Reset to ${(defaultValue * factor).toFixed(decimals)}${unit}`}
        onClick={() => { onGestureStart?.(); onChange(defaultValue); range.current?.focus(); }}><RotateCcw size={13}/></button>
      {actions}
    </div>
    <input ref={range} type="range" aria-label={t(label)} aria-valuetext={`${shown}${unit}`} style={{ '--fill': `${percent}%` } as React.CSSProperties} min={min} max={max} step={step} value={value}
      onPointerDown={startGesture}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); open(); return; }
        if (!event.repeat) startGesture();
        const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
        if (direction && event.shiftKey) { event.preventDefault(); onChange(snapValue(value + direction * step * 10, min, max, step), group.current); }
      }}
      onChange={(event) => onChange(Number(event.target.value), group.current)}/>
  </div>;
}

export type TimeFieldProps = { label: string; value: number; fps: number; onChange?: (seconds: number) => void };

/** A time to type: "2.5" is seconds, and "1:02.15" is minutes, seconds and frames. */
export function TimeField({ label, value, fps, onChange }: TimeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const editing = draft !== null;
  const shown = formatTime(value, fps);
  const close = () => { setDraft(null); setInvalid(false); };
  const save = (keepOpenIfBad: boolean) => {
    if (draft === null || box.finished.current) return;
    const next = parseTime(draft, fps);
    if (next === null && keepOpenIfBad) { setInvalid(true); return; }
    box.finished.current = true;
    close();
    if (next !== null && next !== Math.round(value * fps) / fps) onChange?.(next);
  };
  const box = useEditBox(editing, () => save(false));
  return <div className="ed-time"><span>{label}</span>
    {!onChange ? <em aria-label={`${label}, ${shown}`}>{shown}</em>
      : editing ? <input ref={box.input} type="text" inputMode="decimal" aria-label={`${label} time`} aria-invalid={invalid} value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }} onBlur={() => save(false)}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') save(true); else if (event.key === 'Escape') { box.finished.current = true; close(); } }}/>
        : <button className="ed-value" title="Double-click to type. 2.5 is seconds, 1:02.15 is minutes, seconds and frames." aria-label={`Edit ${label}, ${shown}`} onDoubleClick={() => setDraft(shown)} onClick={(event) => { if (event.detail === 0) setDraft(shown); }}>{shown}</button>}
  </div>;
}
