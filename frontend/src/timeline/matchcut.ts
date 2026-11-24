/** Match-cut finder on the timeline (match_cut_service.py finds them): a suggested cut is used by trimming the first
 *  clip to end on its matching frame, starting the second on its own, and placing the second right after the first,
 *  as a plain cut (no transition: the match is the transition). One step, so ⌘Z undoes it. */
import { clipLength, mainLayer, moveClip, updateClip, type Timeline } from './model.ts';

export type MatchCut = { from: string; to: string; from_at: number; to_at: number; score: number; why: string; from_picture: string; to_picture: string };
const SHORTEST = 0.2;  // Seconds a clip keeps at least.
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The main track's video clips as the finder needs them. */
export function matchCutClips(timeline: Timeline, isVideo: (mediaId: number) => boolean) {
  return mainLayer(timeline).items.filter((clip) => isVideo(clip.media_id) && !clip.reverse && !clip.ramp && clip.freeze == null)
    .map((clip) => ({ id: clip.id, media_id: clip.media_id, in: clip.in, out: clip.out }));
}

/** How good a match is, in words. */
export const matchStrength = (score: number) => (score >= 0.85 ? 'Seamless' : score >= 0.7 ? 'Strong' : 'Worth a look');

export function applyMatchCut(timeline: Timeline, cut: MatchCut): Timeline {
  const clips = mainLayer(timeline).items;
  const first = clips.find((clip) => clip.id === cut.from), second = clips.find((clip) => clip.id === cut.to);
  if (!first || !second) return timeline;
  const frame = 1 / (timeline.format.fps || 30);
  const out = round(Math.max(first.in + SHORTEST * first.speed, Math.min(first.out, cut.from_at + frame)));
  const into = round(Math.min(second.out - SHORTEST * second.speed, Math.max(second.in, cut.to_at)));
  let next = updateClip(updateClip(timeline, first.id, { out }), second.id, { in: into, transition_in: null });
  const order = mainLayer(next).items.map((clip) => clip.id);
  const from = order.indexOf(second.id), at = order.indexOf(first.id);
  next = moveClip(next, second.id, from > at ? at + 1 : at);
  return next;
}

/** Whether a suggestion is already in place: the second clip follows the first, cut where suggested. */
export function isUsed(timeline: Timeline, cut: MatchCut): boolean {
  const clips = mainLayer(timeline).items;
  const at = clips.findIndex((clip) => clip.id === cut.from);
  const next = clips[at + 1];
  return at >= 0 && next?.id === cut.to && Math.abs(clips[at].out - cut.from_at) < 0.1 && Math.abs(next.in - cut.to_at) < 0.05 && clipLength(next) > 0;
}
