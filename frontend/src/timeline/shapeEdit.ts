/** Reading back a title's drawn cover (the "In front" copy's shape mask), so drawing again starts from it. */
import { findText, type Timeline } from './model.ts';

export type DrawMode = 'ground' | 'outline';

/** The points as they were drawn: for a skyline, the line along its top (without the frame's edges and corners
 * groundShape adds); for an outline, its corners. Null when the title has no drawn cover of that kind. */
export function drawnPoints(timeline: Timeline, textId: string, mode: DrawMode): [number, number][] | null {
  const found = findText(timeline, textId);
  if (!found) return null;
  const next = timeline.layers[timeline.layers.indexOf(found.layer) + 1];
  if (next?.kind !== 'video' || next.name !== 'In front') return null;
  const points = next.items[0]?.shape_mask?.points;
  if (!points || points.length < 3) return null;
  const n = points.length;
  // groundShape: [0, y0], ...line, [1, yN], [1, 1], [0, 1].
  const ground = n >= 6 && points[0][0] === 0 && points[n - 1][0] === 0 && points[n - 1][1] === 1 && points[n - 2][0] === 1 && points[n - 2][1] === 1 && points[n - 3][0] === 1;
  if (ground !== (mode === 'ground')) return null;
  return (ground ? points.slice(1, n - 3) : points).map(([x, y]) => [x, y] as [number, number]);
}
