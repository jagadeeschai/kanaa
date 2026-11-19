/**
 * Slice into pieces: at the end of a clip, its last picture is cut into strips that slide away in opposite directions,
 * showing the next clip beneath. Each strip is an ordinary clip (the same picture, cropped to its strip, held still) on
 * its own layer, with ordinary position keyframes, so any of them can be changed afterwards in Animate. The crop and the
 * moves are drawn alike by the preview, the export and the GPU engine.
 */
import { valueAt } from './evaluate.ts';
import { clipLength, mainLayer, MAX_VIDEO_LAYERS, REST_TRANSFORM, type Clip, type SourceFacts, type Timeline, type VideoLayer } from './model.ts';

export type SliceStyle = 'sideways' | 'opposite' | 'four' | 'up-down' | 'diagonal';
export const SLICES: { id: SliceStyle; label: string; pieces: number; strips: 'rows' | 'columns'; diagonal?: boolean }[] = [
  { id: 'sideways', label: '2 pieces, sideways', pieces: 2, strips: 'columns' },
  { id: 'opposite', label: '3 slices, opposite ways', pieces: 3, strips: 'rows' },
  { id: 'four', label: '4 slices', pieces: 4, strips: 'rows' },
  { id: 'up-down', label: 'Up and down', pieces: 3, strips: 'columns' },
  { id: 'diagonal', label: 'Diagonal', pieces: 3, strips: 'rows', diagonal: true },
];
export const SLICE_SECONDS = 0.8;
export const SLICE_LAYER = 'Slice';
const AWAY = 1.15;  // How far each piece travels, in frame widths or heights (more for a picture zoomed in).
const round = (value: number) => Math.round(value * 10000) / 10000;

/** The main-track clip after `clip`, if any: what the pieces reveal. */
function nextClip(timeline: Timeline, clip: Clip): Clip | null {
  const ordered = [...mainLayer(timeline).items].sort((a, b) => a.start - b.start);
  return ordered[ordered.indexOf(clip) + 1] ?? null;
}

/** Whether this clip can be sliced: on the main track, with a clip after it, and room for more layers. Null when it can. */
export function cannotSlice(timeline: Timeline, clipId: string, style: SliceStyle): string | null {
  const clip = mainLayer(timeline).items.find((item) => item.id === clipId);
  if (!clip) return 'Slice a clip on the main track.';
  if (!nextClip(timeline, clip)) return 'Slice a clip that has another clip after it: the pieces slide away to show it.';
  const layers = timeline.layers.filter((layer) => layer.kind === 'video').length;
  const pieces = SLICES.find((each) => each.id === style)!.pieces;
  if (layers + pieces > MAX_VIDEO_LAYERS) return `Slicing needs ${pieces} more video layers; use up to ${MAX_VIDEO_LAYERS}. Delete an overlay layer, or choose fewer pieces.`;
  return null;
}

/** The timeline with the end of `clipId` sliced into pieces over the start of the next clip. */
export function sliceIntoPieces(timeline: Timeline, clipId: string, style: SliceStyle, source: SourceFacts | undefined, newId: () => string, seconds = SLICE_SECONDS): Timeline {
  const problem = cannotSlice(timeline, clipId, style);
  if (problem) throw new Error(problem);
  const main = mainLayer(timeline);
  const clip = main.items.find((item) => item.id === clipId)!;
  const after = nextClip(timeline, clip)!;
  const choice = SLICES.find((each) => each.id === style)!;
  const at = clip.start + clipLength(clip);
  const length = round(Math.max(0.2, Math.min(seconds, clipLength(after))));
  const end = clipLength(clip);
  // The picture as it is at the clip's last moment, held still.
  const pose = { x: valueAt(clip.transform, 'x', end), y: valueAt(clip.transform, 'y', end), scale: valueAt(clip.transform, 'scale', end),
    rotation: valueAt(clip.transform, 'rotation', end), opacity: valueAt(clip.transform, 'opacity', end) };
  const video = source?.media_type === 'video';
  const last = Math.max(0, clip.out - 1 / timeline.format.fps);
  const inPoint = video ? Math.max(0, Math.min(last, clip.out - length)) : 0;
  const travel = AWAY * Math.max(1, pose.scale);
  const layers: VideoLayer[] = Array.from({ length: choice.pieces }, (_, index) => {
    const lo = round(index / choice.pieces), hi = round((index + 1) / choice.pieces);
    const crop = choice.strips === 'rows' ? { x0: 0, y0: lo, x1: 1, y1: hi } : { x0: lo, y0: 0, x1: hi, y1: 1 };
    // Neighbours go opposite ways: rows left and right, columns up and down; diagonal adds the other way too.
    const sign = index % 2 === 0 ? -1 : 1;
    const [dx, dy] = choice.strips === 'rows' ? [sign * travel, choice.diagonal ? sign * travel * 0.6 : 0] : [0, sign * travel];
    const piece: Clip = { ...clip, id: newId(), name: `${clip.name ?? 'Picture'} · piece ${index + 1}`, start: round(at), in: round(inPoint), out: round(inPoint + length), speed: 1,
      volume: 0, muted: true, fade_in: 0, fade_out: 0, enter: null, exit: null, transition_in: null, ramp: null, reverse: false, popout: null,
      freeze: video ? round(last) : null, crop,
      transform: { ...REST_TRANSFORM, ...pose, keyframes: {
        x: [{ t: 0, v: round(pose.x), ease: 'easeInOut' }, { t: length, v: round(pose.x + dx), ease: 'easeInOut' }],
        y: [{ t: 0, v: round(pose.y), ease: 'easeInOut' }, { t: length, v: round(pose.y + dy), ease: 'easeInOut' }],
      } } };
    return { id: newId(), kind: 'video', name: `${SLICE_LAYER} ${index + 1}`, items: [piece] };
  });
  const position = timeline.layers.indexOf(main) + 1;
  return { ...timeline, layers: [...timeline.layers.slice(0, position), ...layers, ...timeline.layers.slice(position)] };
}
