import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const THEME_KEY = 'wa.editorTheme';
const LAYOUT_KEY = 'wa.editorLayout';
const STEP = 16;

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* A private window keeps it for this visit only. */ } };

const systemIsDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** One theme for the whole app. Set on <html>, which the lyric editor's styles already follow. */
export function useAppTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => { const saved = read(THEME_KEY); return saved === 'light' || saved === 'dark' ? saved : 'system'; });
  const [dark, setDark] = useState(systemIsDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const next = () => { const value = choice === 'system' ? 'light' : choice === 'light' ? 'dark' : 'system'; setChoice(value); write(THEME_KEY, value); };
  const theme = choice === 'system' ? (dark ? 'dark' : 'light') : choice;
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return { choice, next, theme };
}

export type Layout = { media: number; inspector: number; timeline: number; mediaOpen: boolean; inspectorOpen: boolean };
export const DEFAULT_LAYOUT: Layout = { media: 240, inspector: 280, timeline: 230, mediaOpen: true, inspectorOpen: true };
export const LIMITS = { media: [180, 360], inspector: [240, 420], timeline: [128, 620] } as const;

export function useEditorLayout() {
  const [layout, setLayout] = useState<Layout>(() => {
    try { return { ...DEFAULT_LAYOUT, ...JSON.parse(read(LAYOUT_KEY) ?? '{}') }; } catch { return DEFAULT_LAYOUT; }
  });
  const update = useCallback((changes: Partial<Layout>) => setLayout((current) => { const next = { ...current, ...changes }; write(LAYOUT_KEY, JSON.stringify(next)); return next; }), []);
  const reset = useCallback(() => update(DEFAULT_LAYOUT), [update]);
  return { layout, update, reset };
}

/** A drag handle between panels. `sign` is -1 when dragging toward the start makes the panel larger. */
export function Splitter({ label, axis, value, min, max, sign, onChange, onReset }: { label: string; axis: 'x' | 'y'; value: number; min: number; max: number; sign: 1 | -1; onChange: (value: number) => void; onReset: () => void }) {
  const drag = useRef<{ from: number; value: number } | null>(null);
  const limit = (next: number) => Math.round(Math.max(min, Math.min(max, next)));
  const at = (event: React.PointerEvent) => (axis === 'x' ? event.clientX : event.clientY);
  return <div className={`ed-split ${axis}`} role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0} title="Drag to resize. Double-click to reset."
    onDoubleClick={onReset}
    onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { from: at(event), value }; }}
    onPointerMove={(event) => { if (drag.current) onChange(limit(drag.current.value + (at(event) - drag.current.from) * sign)); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(event) => {
      const grow = axis === 'x' ? (sign === 1 ? 'ArrowRight' : 'ArrowLeft') : (sign === 1 ? 'ArrowDown' : 'ArrowUp');
      const shrink = axis === 'x' ? (sign === 1 ? 'ArrowLeft' : 'ArrowRight') : (sign === 1 ? 'ArrowUp' : 'ArrowDown');
      if (event.key === grow) onChange(limit(value + STEP));
      else if (event.key === shrink) onChange(limit(value - STEP));
      else if (event.key === 'Home') onChange(min);
      else if (event.key === 'End') onChange(max);
      else return;
      event.preventDefault();
    }}/>;
}

const opened = new Map<string, boolean>();

/** A settings group. Several can stay open, and each remembers its state until the page reloads. */
export function Group({ title, startOpen = false, changed = false, children }: { title: string; startOpen?: boolean; changed?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(opened.get(title) ?? startOpen);
  return <section className={`ed-group ${open ? 'open' : ''}`}>
    <button className="ed-group-head" aria-expanded={open} onClick={() => { opened.set(title, !open); setOpen(!open); }}><ChevronRight size={14}/><span>{title}</span>{changed && <i title="Changed from the default"/>}</button>
    {open && <div className="ed-group-body">{children}</div>}
  </section>;
}
