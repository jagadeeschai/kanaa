import type { ExplainerGraphic } from '../../timeline/model';
import { t } from '../../i18n';

type Point = [number, number];
const clamp = (value: number) => Math.round(Math.max(.01, Math.min(.99, value)) * 1000) / 1000;

export function GraphicHandles({ graphic, onChange }: { graphic: ExplainerGraphic; onChange: (graphic: ExplainerGraphic, group: string) => void }) {
  const drag = (kind: 'from' | 'to' | 'size', event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const target = event.currentTarget, frame = target.parentElement!.getBoundingClientRect();
    const start: Point = [event.clientX, event.clientY];
    const original = graphic;
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - start[0]) / frame.width, dy = (next.clientY - start[1]) / frame.height;
      if (kind === 'from') onChange({ ...original, from: [clamp(original.from[0] + dx), clamp(original.from[1] + dy)] }, 'graphic-from');
      else if (kind === 'to') {
        const to: Point = [clamp(original.to[0] + dx), clamp(original.to[1] + dy)];
        const whole = graphic.kind !== 'arrow-straight' && graphic.kind !== 'arrow-curved' && graphic.kind !== 'callout';
        const from: Point = whole ? [clamp(original.from[0] + dx), clamp(original.from[1] + dy)] : original.from;
        const shape = original.shape?.map(([x, y]) => [Math.round(Math.max(-.05, Math.min(1.05, x + to[0] - original.to[0])) * 10000) / 10000, Math.round(Math.max(-.05, Math.min(1.05, y + to[1] - original.to[1])) * 10000) / 10000] as Point);
        onChange({ ...original, from, to, ...(shape ? { shape } : {}) }, 'graphic-to');
      } else onChange({ ...original, width: Math.max(.03, Math.min(1, original.width + dx * 2)), height: Math.max(.03, Math.min(1, original.height + dy * 2)) }, 'graphic-size');
    };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up);
  };
  const handle = (kind: 'from' | 'to' | 'size', point: Point, label: string) => <button className={`ed-graphic-handle ${kind}`} aria-label={t(label)} title={t(label)} style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }} onPointerDown={(event) => drag(kind, event)}/>;
  const highlight = graphic.kind === 'circle' || graphic.kind === 'box' || graphic.kind === 'spotlight' || graphic.kind === 'lower-third' || graphic.kind === 'count-up';
  const outline = graphic.kind === 'outline';
  return <div className="ed-graphic-handles" aria-label={t('Graphic handles')}>
    {!highlight && !outline && handle('from', graphic.from, 'Move arrow tail')}
    {handle('to', graphic.to, highlight || outline ? 'Move highlight' : 'Move arrow point')}
    {highlight && handle('size', [clamp(graphic.to[0] + graphic.width / 2), clamp(graphic.to[1] + graphic.height / 2)], 'Resize highlight')}
  </div>;
}
