import { mainLayer, type Timeline } from './model.ts';
import type { TransitionKind } from './animation.ts';

/** One transition on every join of the main track: every clip after the first opens with it. One Undo sets them all. */
export function transitionEverywhere(timeline: Timeline, kind: TransitionKind, duration: number): Timeline {
  const main = mainLayer(timeline);
  return {
    ...timeline,
    layers: timeline.layers.map((layer) =>
      layer === main ? { ...main, items: main.items.map((clip, index) => (index > 0 ? { ...clip, transition_in: { kind, duration } } : clip)) } : layer),
  };
}

/** Takes every transition off the main track. */
export function clearTransitions(timeline: Timeline): Timeline {
  const main = mainLayer(timeline);
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => (layer === main ? { ...main, items: main.items.map((clip) => ({ ...clip, transition_in: null })) } : layer)),
  };
}

/** Every transition sorted by what it does, for the popover on a cut. Every kind is in exactly one group. */
export const TRANSITION_GROUPS: { label: string; kinds: TransitionKind[] }[] = [
  { label: 'Blend', kinds: ['crossfade', 'cross-blur', 'dip', 'flash', 'ripple'] },
  { label: 'Push and wipe', kinds: ['wipe', 'slide', 'whip', 'swap'] },
  { label: 'Zoom and spin', kinds: ['zoom', 'cross-zoom', 'spin-in', 'spin-out'] },
  { label: 'Shapes', kinds: ['circle-open', 'circle-close', 'doorway', 'mosaic', 'puzzle-left', 'puzzle-right'] },
  { label: '3D', kinds: ['cube', 'page-curl-left', 'page-curl-right'] },
];
