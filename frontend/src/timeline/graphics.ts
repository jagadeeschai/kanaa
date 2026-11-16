import type { TextItem } from './model';

export const GRAPHIC_STATES = 24; // Matches backend/app/services/explainer_graphics.py.

export function graphicState(item: TextItem, local: number): number | null {
  if (!item.graphic || item.enter?.preset !== 'reveal') return null;
  const duration = Math.max(1e-6, Math.min(item.length, item.enter.duration));
  const q = Math.min(1, Math.max(0, local / duration));
  const eased = 1 - (1 - q) ** 3;
  return Math.min(GRAPHIC_STATES - 1, Math.max(0, Math.round(eased * (GRAPHIC_STATES - 1))));
}
