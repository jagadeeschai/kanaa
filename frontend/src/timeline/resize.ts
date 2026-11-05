import { valueAt } from './evaluate.ts';
import { fittedSize, type Clip, type Format } from './model.ts';

export const MIN_SIZE = 0.05;
export const MAX_SIZE = 8;

/** Where a clip sits in the frame, in shares of the frame's width and height (as drawn, before enter and exit moves). */
export function clipBox(clip: Clip, source: { width: number; height: number }, format: Format, local: number) {
  const fitted = fittedSize(source, clip.adjust.rotation, format);
  const scale = valueAt(clip.transform, 'scale', local);
  return { x: valueAt(clip.transform, 'x', local), y: valueAt(clip.transform, 'y', local), width: (fitted.width * scale) / format.width, height: (fitted.height * scale) / format.height, scale, turn: valueAt(clip.transform, 'rotation', local) };
}

/** Dragging a corner from `start` to `to` (pixels in a frame `frameWidth` × `frameHeight`): the size keeps its shape, and the
 *  opposite corner stays where it is, or the centre does when `fromCentre`. */
export function resizeTo(start: { x: number; y: number; width: number; height: number; scale: number; turn: number }, corner: readonly [number, number], to: { x: number; y: number }, frame: { width: number; height: number }, fromCentre: boolean) {
  const angle = (start.turn * Math.PI) / 180;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  const cx = start.x * frame.width; const cy = start.y * frame.height;
  const half = { x: (start.width * frame.width) / 2, y: (start.height * frame.height) / 2 };
  // The pointer, turned into the box's own upright frame around its centre.
  const dx = to.x - cx; const dy = to.y - cy;
  const lx = dx * cos + dy * sin; const ly = -dx * sin + dy * cos;
  const [sx, sy] = corner;
  let factor: number;
  if (fromCentre) factor = (lx * sx * half.x + ly * sy * half.y) / (half.x ** 2 + half.y ** 2);
  else {
    // Projected on the diagonal from the fixed corner, so the drag feels the same whichever way the pointer strays.
    const ax = -sx * half.x; const ay = -sy * half.y;
    factor = ((lx - ax) * sx * 2 * half.x + (ly - ay) * sy * 2 * half.y) / (4 * (half.x ** 2 + half.y ** 2));
  }
  const scale = Math.min(MAX_SIZE, Math.max(MIN_SIZE, start.scale * factor));
  const grown = scale / start.scale;
  if (fromCentre) return { x: start.x, y: start.y, scale };
  // The centre slides along the box's own axes so the opposite corner stays put.
  const shiftX = sx * half.x * (grown - 1); const shiftY = sy * half.y * (grown - 1);
  return { x: (cx + shiftX * cos - shiftY * sin) / frame.width, y: (cy + shiftX * sin + shiftY * cos) / frame.height, scale };
}

/** The four corners on screen, in shares of the frame, turned with the clip: top left, top right, bottom left, bottom right. */
export function boxCorners(box: { x: number; y: number; width: number; height: number; turn: number }, format: { width: number; height: number }) {
  const angle = (box.turn * Math.PI) / 180;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  return ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy]) => {
    const hx = (sx * box.width * format.width) / 2; const hy = (sy * box.height * format.height) / 2;
    return { sx, sy, x: box.x + (hx * cos - hy * sin) / format.width, y: box.y + (hx * sin + hy * cos) / format.height };
  });
}
