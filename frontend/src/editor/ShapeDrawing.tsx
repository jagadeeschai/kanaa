/**
 * Drawing what stays in front of a title, over the preview: a skyline (the top of the ground or mountains) or the
 * outline of something still. Click to add a point, drag a point to move it, and finish with the buttons (or Enter;
 * Backspace undoes a point, Esc cancels). An outline also closes by clicking its first point.
 */
import { useRef } from 'react';
import { Check, Eraser, Undo2, X } from 'lucide-react';
import { t } from '../i18n';
import { groundShape } from '../timeline/model';
import type { DrawMode } from '../timeline/shapeEdit';

export const SHAPE_CLOSE = 0.03;  // Clicking this near the first point closes an outline.
const NEEDED: Record<DrawMode, number> = { ground: 2, outline: 3 };

export function ShapeDrawing({ mode, points, onPoints, onDone, onCancel }: { mode: DrawMode; points: [number, number][]; onPoints: (points: [number, number][]) => void; onDone: () => void; onCancel: () => void }) {
  const dragging = useRef<number | null>(null);
  const at = (event: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
  };
  const shape = mode === 'ground' && points.length >= 2 ? groundShape(points) : points;
  const missing = Math.max(0, NEEDED[mode] - points.length);
  return <>
    <svg className="ed-shape" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={mode === 'ground' ? t('Click along the top of the ground') : t('Click around the shape')}
      onPointerDown={(event) => {
        const point = at(event);
        const rect = event.currentTarget.getBoundingClientRect();
        // A point under the pointer (in screen pixels, so it works at any size) is picked up to move.
        const near = points.findIndex(([x, y]) => Math.hypot((x - point[0]) * rect.width, (y - point[1]) * rect.height) < 12);
        if (near === 0 && mode === 'outline' && points.length >= 3) { onDone(); return; }
        if (near >= 0) { dragging.current = near; event.currentTarget.setPointerCapture(event.pointerId); return; }
        onPoints([...points, point]);
      }}
      onPointerMove={(event) => { const index = dragging.current; if (index !== null) { const point = at(event); onPoints(points.map((p, i) => (i === index ? point : p))); } }}
      onPointerUp={() => { dragging.current = null; }}>
      {points.length > 0 && <polygon points={shape.map(([x, y]) => `${x},${y}`).join(' ')} className={mode === 'ground' || points.length >= 3 ? 'fill' : ''}/>}
      {points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="0.011" className={index === 0 && mode === 'outline' ? 'first' : ''}/>)}
    </svg>
    <div className="ed-shape-bar" role="toolbar" aria-label={t('Drawing')}>
      <span>{missing ? t(mode === 'ground' ? 'Click along the top of the hills or skyline — {n} more' : 'Click around what stays in front — {n} more', { n: missing })
        : t(mode === 'ground' ? 'Drag a point to adjust, or click to add one' : 'Drag a point to adjust; click the first point to close')}</span>
      <button className="ed-button small" disabled={!points.length} onClick={() => onPoints(points.slice(0, -1))} title={t('Undo the last point (Backspace)')}><Undo2 size={13}/>{t('Undo')}</button>
      <button className="ed-button small" disabled={!points.length} onClick={() => onPoints([])} title={t('Start again')}><Eraser size={13}/>{t('Clear')}</button>
      <button className="ed-button small" onClick={onCancel} title={t('Cancel (Esc)')}><X size={13}/>{t('Cancel')}</button>
      <button className="ed-button small primary" disabled={missing > 0} onClick={onDone} title={t('Put the title behind it (Enter)')}><Check size={13}/>{t('Done')}</button>
    </div>
  </>;
}
