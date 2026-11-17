/**
 * Lyric layouts: where a lyric video's lines sit, in one click. Two-line shows the line being sung with the next one
 * dim beneath it (as karaoke viewers expect); Lower third tucks the lines bottom left on a band; Big centre makes each
 * line large in the middle (for Shorts and portrait). The lines stay ordinary titles, so karaoke, word motion and the
 * chorus style carry on, and one undo takes a layout back.
 */
import { markOwn, updateText, REST_TRANSFORM, type TextItem, type TextLayer, type Timeline } from './model.ts';
import { lyricLines } from './song-sections.ts';

export type LyricLayout = 'two-line' | 'lower-third' | 'big-centre';
export const LYRIC_LAYOUTS: { id: LyricLayout; label: string; tip: string }[] = [
  { id: 'two-line', label: 'Two lines', tip: 'The line being sung, with the next one dim beneath it' },
  { id: 'lower-third', label: 'Lower third', tip: 'Lines bottom left on a soft band, leaving the picture clear' },
  { id: 'big-centre', label: 'Big centre', tip: 'Each line large in the middle: good for Shorts and portrait videos' },
];

export const NEXT_LAYER = 'lyric-next-lines';
const NEXT_SHARE = 0.7;  // The next line's size, of the sung line's.
const NEXT_OPACITY = 0.45;
const NEXT_FADE = 0.2;
const BIG_GROWTH = 1.3;
const round = (value: number) => Math.round(value * 10000) / 10000;

/** How tall a line of `size` is, as a share of the frame's height (titles are sized by the frame's width, at 720 wide). */
const lineHeight = (size: number, timeline: Timeline) => 1.3 * size * (timeline.format.width / 720) / timeline.format.height;

/** The next-line layer taken away, and each line back to the layer's own place, so layouts don't pile up. */
export function clearLyricLayout(timeline: Timeline): Timeline {
  return { ...timeline, layers: timeline.layers.filter((layer) => layer.id !== NEXT_LAYER) };
}

function restyle(timeline: Timeline, line: TextItem, changes: Partial<TextItem>): Timeline {
  return markOwn(updateText(timeline, line.id, changes), line.id, changes);
}

/** `timeline` with its lyric lines laid out as `layout`. `size` is each line's own size before; the layouts set it from that. */
export function applyLyricLayout(timeline: Timeline, layout: LyricLayout): Timeline {
  let next = clearLyricLayout(timeline);
  const lines = lyricLines(next);
  if (!lines.length) return timeline;
  const still = (line: TextItem) => ({ ...REST_TRANSFORM, ...line.transform, x: 0.5, y: 0.5, keyframes: {} });
  if (layout === 'lower-third') {
    for (const line of lines) next = restyle(next, line, { position: 'bottom', align: 'left', style: 'band', transform: still(line) });
    return next;
  }
  if (layout === 'big-centre') {
    // Already big in the middle: a second click doesn't grow the lines again.
    const already = lines.every((line) => line.position === 'center' && (line.transform?.y ?? 0.5) === 0.5) && !timeline.layers.some((layer) => layer.id === NEXT_LAYER);
    for (const line of lines) next = restyle(next, line, { position: 'center', align: 'center', style: line.style === 'band' ? 'shadow' : line.style, size: already ? line.size : Math.min(100, Math.round(line.size * BIG_GROWTH)), transform: still(line) });
    return next;
  }
  // Two lines: the sung line a little above the middle, the next one beneath it, dim and smaller, for as long as this one shows.
  const items: TextItem[] = [];
  lines.forEach((line, index) => {
    const gap = lineHeight(line.size, next) * 0.55;
    next = restyle(next, line, { position: 'center', align: 'center', transform: { ...still(line), y: round(0.5 - gap) } });
    const after = lines[index + 1];
    if (!after || after.start - (line.start + line.length) > 2) return;  // A pause or the end: nothing waits.
    items.push({ id: `lyric-next-${line.id}`, start: line.start, length: line.length, text: after.text, style: line.style, position: 'center', align: 'center',
      color: line.color, size: Math.max(20, Math.round(line.size * NEXT_SHARE)), font: line.font ?? null, tamil_font: line.tamil_font ?? null, band_color: line.band_color ?? null,
      enter: { preset: 'fade', duration: NEXT_FADE }, exit: { preset: 'fade', duration: NEXT_FADE },
      transform: { ...REST_TRANSFORM, opacity: NEXT_OPACITY, y: round(0.5 + lineHeight(line.size, next) * 0.6) } });
  });
  if (!items.length) return next;
  const layer: TextLayer = { id: NEXT_LAYER, kind: 'text', name: 'Next lines', ripple: false, items };
  const at = next.layers.findIndex((each) => each.kind === 'text');
  return { ...next, layers: [...next.layers.slice(0, at), layer, ...next.layers.slice(at)] };
}
