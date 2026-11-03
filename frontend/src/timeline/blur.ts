import type { Format } from './model';

/** A blur's strength at 1, as a share of the frame height. Matches BLUR_REACH in timeline_service.py. */
export const BLUR_REACH = 0.04;
/** How soft a blur box's edge is, as a share of its half-size. */
export const BLUR_FEATHER = 0.12;
const BLOCK_REACH = 0.06;

/** Columns and rows of blocks when pixelating. Matches blur_grid in timeline_service.py, at any export size. */
export function blurGrid(amount: number, format: Pick<Format, 'width' | 'height'>): [number, number] {
  const rows = Math.max(2, Math.round(1 / (Math.max(0.05, amount) * BLOCK_REACH)));
  return [Math.max(2, Math.round((rows * format.width) / format.height)), rows];
}
