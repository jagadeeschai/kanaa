import type { ExplainerGraphic, TextItem, Timeline } from './model';

/** Mirrors backend/app/services/compare_graphics.py exactly: the preview cuts the clip where the export does. */
const MAX_STEPS = 88;
const DEFAULTS = { split_from: 1, split_to: .5, split_delay: .3, split_move: 1.2 };
const settings = (graphic: ExplainerGraphic) => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(graphic).filter(([, value]) => value != null)) }) as typeof DEFAULTS;
const step = (move: number, fps: number) => Math.max(1 / fps, move / MAX_STEPS);

export function compareStates(item: TextItem, fps: number): number[] {
  const { split_delay: delay, split_move: move } = settings(item.graphic!);
  const size = step(move, fps), count = Math.ceil(move / size - 1e-9);
  const times = new Set([0, ...Array.from({ length: count + 1 }, (_, k) => delay + Math.min(move, k * size))]);
  return [...times].sort((a, b) => a - b);
}

export function splitAt(graphic: ExplainerGraphic, local: number, fps: number): number {
  const { split_from: from, split_to: to, split_delay: delay, split_move: move } = settings(graphic);
  if (local < delay) return from;
  const size = step(move, fps), shown = Math.min(move, Math.floor((local - delay) / size + 1e-6) * size), q = Math.min(1, Math.max(0, shown / move));
  return from + (to - from) * q * q * (3 - 2 * q);
}

/** The divider that reveals this clip, if any (the first, as in the export). */
export function dividerFor(timeline: Timeline, clipId: string): TextItem | undefined {
  for (const layer of timeline.layers) {
    if (layer.kind !== 'text' || layer.hidden) continue;
    const found = layer.items.find((item) => item.graphic?.kind === 'compare-divider' && item.graphic.compare_clip === clipId);
    if (found) return found;
  }
  return undefined;
}
