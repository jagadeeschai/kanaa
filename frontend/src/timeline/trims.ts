/**
 * Slip and roll: the two trims that keep the video's total length.
 * - Slip: a clip stays where it is on the timeline; a different part of its source plays (in and out move together).
 * - Roll: the cut between two neighbouring clips on the main track moves; one gets longer, the other shorter.
 * Neither moves anything else on the timeline, so titles, lyrics and the song stay where they are.
 */
import { shiftKeys } from './keyframes.ts';
import { clipLength, mainLayer, MAX_PHOTO_SECONDS, MIN_CLIP_SECONDS, overlayLayers, type Clip, type SourceFacts, type Timeline } from './model.ts';

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Pictures and frozen frames show the same thing throughout, so they have no source to slip or a fixed one. */
const stillLike = (clip: Clip, source?: SourceFacts) => source?.media_type === 'image' || clip.freeze != null;
const sourceEnd = (clip: Clip, source?: SourceFacts) => (stillLike(clip, source) ? MAX_PHOTO_SECONDS : source?.duration ?? clip.out);

function replaceClip(timeline: Timeline, next: Clip): Timeline {
  return { ...timeline, layers: timeline.layers.map((layer) => (layer.kind === 'video' && layer.items.some((clip) => clip.id === next.id)
    ? { ...layer, items: layer.items.map((clip) => (clip.id === next.id ? next : clip)) } : layer)) };
}

/** How far (in source seconds) a clip can slip each way: [earliest, latest] delta. */
export function slipRange(clip: Clip, source?: SourceFacts): [number, number] {
  if (stillLike(clip, source)) return [0, 0];
  return [round(-clip.in), round(Math.max(0, sourceEnd(clip, source) - clip.out))];
}

/** Plays `delta` source seconds later (earlier when negative), within the source. Its place and length stay. */
export function slipClip(timeline: Timeline, id: string, delta: number, source?: SourceFacts): Timeline {
  const clip = [mainLayer(timeline), ...overlayLayers(timeline)].flatMap((layer) => layer.items).find((item) => item.id === id);
  if (!clip) return timeline;
  const [low, high] = slipRange(clip, source);
  const by = round(Math.min(high, Math.max(low, delta)));
  if (!by) return timeline;
  return replaceClip(timeline, { ...clip, in: round(clip.in + by), out: round(clip.out + by) });
}

/** How far (in timeline seconds) the cut after `left` can roll each way: [earliest, latest] delta. */
export function rollRange(left: Clip, right: Clip, leftSource?: SourceFacts, rightSource?: SourceFacts): [number, number] {
  if (left.ramp || right.ramp) return [0, 0];  // A ramp's timing is a curve over its whole length; rolling would bend it.
  const leftLength = clipLength(left); const rightLength = clipLength(right);
  // Shortest each may become, and the most source each has beyond the cut.
  const leftMore = left.reverse ? left.in / left.speed : (sourceEnd(left, leftSource) - left.out) / left.speed;
  const rightMore = right.reverse ? (sourceEnd(right, rightSource) - right.out) / right.speed : right.in / right.speed;
  return [round(-Math.min(leftLength - MIN_CLIP_SECONDS, rightMore)), round(Math.min(rightLength - MIN_CLIP_SECONDS, leftMore))];
}

/**
 * Moves the cut between `leftId` and the clip right after it by `delta` timeline seconds. The two together keep
 * their length, so nothing after them moves. The right clip's moves keep their place in its picture.
 */
export function rollCut(timeline: Timeline, leftId: string, rightId: string, delta: number, leftSource?: SourceFacts, rightSource?: SourceFacts): Timeline {
  const main = mainLayer(timeline);
  const index = main.items.findIndex((clip) => clip.id === leftId);
  const left = main.items[index]; const right = main.items[index + 1];
  if (!left || right?.id !== rightId) return timeline;
  const [low, high] = rollRange(left, right, leftSource, rightSource);
  const by = round(Math.min(high, Math.max(low, delta)));
  if (!by) return timeline;
  const longer: Clip = left.reverse ? { ...left, in: round(left.in - by * left.speed) } : { ...left, out: round(left.out + by * left.speed) };
  const shorter: Clip = { ...(right.reverse ? { ...right, out: round(right.out - by * right.speed) } : { ...right, in: round(right.in + by * right.speed) }),
    start: round(right.start + by), transform: shiftKeys(right.transform, -by) };
  if (left.reverse) longer.transform = left.transform;  // Its start shows the same moment; its keys stay.
  const items = main.items.map((clip) => (clip.id === leftId ? longer : clip.id === rightId ? shorter : clip));
  return { ...timeline, layers: timeline.layers.map((layer) => (layer === main ? { ...main, items } : layer)) };
}
