/**
 * Draw its path: press the button, then drag across the preview where the clip or title should travel. Kanaa turns the
 * stroke into a smooth route over the item's time (from the playhead to its end). Esc or a click cancels.
 */
import { useEffect, useRef, useState } from 'react';
import { PenLine } from 'lucide-react';
import { t } from '../i18n';
import type { Transform } from '../timeline/evaluate';
import { pathFromStroke, type PathFeel } from '../timeline/path-draw';

const OPEN = 'kanaa:draw-path';

export function DrawPathButton() {
  const [feel, setFeel] = useState<PathFeel>('smooth');
  return <div className="ed-draw-path">
    <button className="ed-button wide" onClick={() => window.dispatchEvent(new CustomEvent(OPEN, { detail: feel }))}><PenLine size={14}/>{t('Draw its path')}</button>
    <div className="ed-chips" role="group" aria-label={t('How it travels')}>
      {([['smooth', 'Smooth'], ['steady', 'Steady']] as const).map(([id, label]) => <button key={id} className={feel === id ? 'on' : undefined} aria-pressed={feel === id} onClick={() => setFeel(id)}>{t(label)}</button>)}
    </div>
  </div>;
}

/** The drawing surface over the frame, for the selected item. `local` is the playhead in the item's own seconds. */
export function PathDrawer({ transform, length, local, onChange }: { transform: Transform; length: number; local: number; onChange: (transform: Transform, group?: string) => void }) {
  const [feel, setFeel] = useState<PathFeel | null>(null);
  const [stroke, setStroke] = useState<[number, number][]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const open = (event: Event) => { setFeel((event as CustomEvent<PathFeel>).detail); setStroke([]); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setFeel(null); };
    window.addEventListener(OPEN, open); window.addEventListener('keydown', key);
    return () => { window.removeEventListener(OPEN, open); window.removeEventListener('keydown', key); };
  }, []);
  if (!feel) return null;
  const at = (event: React.PointerEvent): [number, number] => {
    const rect = box.current!.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  };
  // From the playhead when there is room after it, else the whole item.
  const from = local >= 0 && local < length - 0.3 ? local : 0;
  const finish = () => {
    const made = pathFromStroke(transform, stroke, from, length, feel);
    if (made) onChange(made, `draw-${Date.now()}`);
    setFeel(null); setStroke([]);
  };
  return <div ref={box} className="ed-draw ed-draw-route" role="application" aria-label={t('Drag where it should travel')}
    onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setStroke([at(event)]); }}
    onPointerMove={(event) => { if (stroke.length) { const point = at(event); setStroke((points) => [...points, point]); } }}
    onPointerUp={finish}>
    <span className="ed-draw-hint">{t('Drag where it should travel. Esc cancels.')}</span>
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" width="100%" height="100%"><polyline points={stroke.map((point) => point.join(',')).join(' ')} vectorEffect="non-scaling-stroke"/></svg>
  </div>;
}
