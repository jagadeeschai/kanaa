import { useRef } from 'react';
import { writeValue } from '../timeline/keyframes';
import type { Transform } from '../timeline/evaluate';
import type { Clip, Format } from '../timeline/model';
import { boxCorners, clipBox, resizeTo } from '../timeline/resize';

const NAMES = ['top left', 'top right', 'bottom left', 'bottom right'];
/** Handles stay this far inside the frame, so a clip that fills it can still be grabbed by its corners. */
const INSET = '9px';

/** The selected clip's outline in the preview, with a handle at each corner to make it bigger or smaller. */
export function ResizeBox({ clip, source, format, local, onChange }: { clip: Clip; source: { width: number; height: number }; format: Format; local: number; onChange: (transform: Transform, group: string) => void }) {
  const drag = useRef<{ corner: readonly [number, number]; start: ReturnType<typeof clipBox>; from: { x: number; y: number }; at: { x: number; y: number }; group: string } | null>(null);
  const box = clipBox(clip, source, format, local);
  const corners = boxCorners(box, format);
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const frame = event.currentTarget.closest('.ed-frame')?.getBoundingClientRect();
    if (!drag.current || !frame) return;
    const { start, corner, from, at, group } = drag.current;
    // The corner follows the pointer from where it really is, even when its handle is held inside the frame.
    const to = { x: at.x * frame.width + event.clientX - from.x, y: at.y * frame.height + event.clientY - from.y };
    const next = resizeTo(start, corner, to, frame, event.altKey);
    onChange(writeValue(writeValue(writeValue(clip.transform, 'scale', local, next.scale), 'x', local, next.x), 'y', local, next.y), group);
  };
  const stop = () => { drag.current = null; };
  return <div className="ed-resize">
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><polygon points={[0, 1, 3, 2].map((index) => `${corners[index].x},${corners[index].y}`).join(' ')} vectorEffect="non-scaling-stroke"/></svg>
    {corners.map((corner, index) => <button key={NAMES[index]} type="button" className={`ed-resize-handle ${corner.sx * corner.sy > 0 ? 'down' : 'up'}`} aria-label={`Resize from the ${NAMES[index]} corner`}
      title="Drag to resize. Hold Option to resize from the middle."
      style={{ left: `clamp(${INSET}, ${corner.x * 100}%, calc(100% - ${INSET}))`, top: `clamp(${INSET}, ${corner.y * 100}%, calc(100% - ${INSET}))` }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { corner: [corner.sx, corner.sy], start: box, from: { x: event.clientX, y: event.clientY }, at: { x: corner.x, y: corner.y }, group: `size-${Date.now()}` };
      }}
      onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}/>)}
    <span className="ed-resize-size" style={{ left: `clamp(30px, ${box.x * 100}%, calc(100% - 30px))`, top: `clamp(14px, ${box.y * 100}%, calc(100% - 14px))` }} aria-hidden="true">{Math.round(box.scale * 100)}%</span>
  </div>;
}
