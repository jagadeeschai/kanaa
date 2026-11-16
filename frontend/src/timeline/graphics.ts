import type { ExplainerGraphic, TextItem } from './model';

export const GRAPHIC_STATES = 24; // Matches backend/app/services/explainer_graphics.py.

export function graphicState(item: TextItem, local: number): number | null {
  if (!item.graphic || item.enter?.preset !== 'reveal') return null;
  const duration = Math.max(1e-6, Math.min(item.length, item.enter.duration));
  const q = Math.min(1, Math.max(0, local / duration));
  const eased = 1 - (1 - q) ** 3;
  return Math.min(GRAPHIC_STATES - 1, Math.max(0, Math.round(eased * (GRAPHIC_STATES - 1))));
}

/** Where a graphic sits at item-local time `local`, for Follow: its own box, moved by its position keys. */
export function graphicBox(graphic: ExplainerGraphic, offset: [number, number]): [number, number, number, number] {
  const [dx, dy] = offset;
  if (graphic.kind === 'outline' && graphic.shape?.length) {
    const xs = graphic.shape.map((p) => p[0]), ys = graphic.shape.map((p) => p[1]);
    const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return [(left + right) / 2 + dx, (top + bottom) / 2 + dy, Math.max(.03, right - left), Math.max(.03, bottom - top)];
  }
  if (graphic.kind === 'circle' || graphic.kind === 'box' || graphic.kind === 'spotlight') return [graphic.to[0] + dx, graphic.to[1] + dy, graphic.width, graphic.height];
  return [graphic.to[0] + dx, graphic.to[1] + dy, .12, .12];  // An arrow or callout follows what its point is on.
}
