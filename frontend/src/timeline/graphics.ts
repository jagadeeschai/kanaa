import type { ExplainerGraphic, TextItem } from './model';

export const GRAPHIC_STATES = 24; // Matches backend/app/services/explainer_graphics.py.
export const MAX_GRAPHIC_STATES = 90;

export function graphicStateCount(item: TextItem, fps: number): number {
  if ((item.graphic?.kind as string) === 'count-up' && item.enter?.preset === 'reveal') {
    const duration = Math.max(1e-6, Math.min(item.length, item.enter.duration));
    return Math.min(MAX_GRAPHIC_STATES, Math.max(2, Math.round(duration * fps) + 1));
  }
  return GRAPHIC_STATES;
}

export function graphicState(item: TextItem, local: number, fps = 24): number | null {
  if (!item.graphic || item.enter?.preset !== 'reveal') return null;
  const states = graphicStateCount(item, fps);
  if (item.graphic.kind === 'lower-third' && item.exit?.preset === 'reveal') {
    const duration = Math.max(1e-6, Math.min(item.length, item.exit.duration));
    if (local > item.length - duration) {
      const q = Math.min(1, Math.max(0, (item.length - local) / duration));
      return Math.min(states - 1, Math.max(0, Math.round((1 - (1 - q) ** 3) * (states - 1))));
    }
  }
  const duration = Math.max(1e-6, Math.min(item.length, item.enter.duration));
  const q = Math.min(1, Math.max(0, local / duration));
  const eased = 1 - (1 - q) ** 3;
  return Math.min(states - 1, Math.max(0, Math.round(eased * (states - 1))));
}

/** Where a graphic sits at item-local time `local`, for Follow: its own box, moved by its position keys. */
export function graphicBox(graphic: ExplainerGraphic, offset: [number, number]): [number, number, number, number] {
  const [dx, dy] = offset;
  if (graphic.kind === 'outline' && graphic.shape?.length) {
    const xs = graphic.shape.map((p) => p[0]), ys = graphic.shape.map((p) => p[1]);
    const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return [(left + right) / 2 + dx, (top + bottom) / 2 + dy, Math.max(.03, right - left), Math.max(.03, bottom - top)];
  }
  if (graphic.kind === 'lower-third') return [graphic.to[0] + graphic.width / 2 + dx, graphic.to[1] + graphic.height / 2 + dy, graphic.width, graphic.height];
  if (graphic.kind === 'count-up') return [graphic.to[0] + dx, graphic.to[1] + dy, graphic.width, graphic.height];
  if (graphic.kind === 'chapter-card') return graphic.card_mode === 'full' ? [.5 + dx, .5 + dy, 1, 1] : [graphic.to[0] + graphic.width / 2 + dx, graphic.to[1] + graphic.height / 2 + dy, graphic.width, graphic.height];
  if (graphic.kind === 'circle' || graphic.kind === 'box' || graphic.kind === 'spotlight') return [graphic.to[0] + dx, graphic.to[1] + dy, graphic.width, graphic.height];
  return [graphic.to[0] + dx, graphic.to[1] + dy, .12, .12];  // An arrow or callout follows what its point is on.
}
