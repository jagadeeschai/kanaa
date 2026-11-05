/**
 * Whooshes on transitions and hits on title reveals. Each sound is placed so its loudest moment (`peak`, found by the
 * backend's sound_effect_service.py) lands exactly on the cut or the reveal. Adding them again replaces the earlier ones.
 */
import { addSound, mainLayer, textLayers, type Sound, type Timeline } from './model.ts';

export type SoundEffect = { asset_id: string; duration: number; name: string; kind: 'whoosh' | 'hit' | 'thunder'; peak: number };
export const SFX_NAMES = { whoosh: 'Whoosh', hit: 'Hit', thunder: 'Thunder' } as const;
export const SFX_VOLUME = 0.7;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Where clips join with a transition: the middle of each transition is the cut. */
export function transitionTimes(timeline: Timeline): number[] {
  const ordered = [...mainLayer(timeline).items].sort((a, b) => a.start - b.start);
  return ordered.slice(1).filter((clip) => clip.transition_in).map((clip) => round(clip.start));
}

/** When each title appears. */
export function titleTimes(timeline: Timeline): number[] {
  return textLayers(timeline).flatMap((layer) => (layer.hidden ? [] : layer.items.map((text) => round(text.start)))).sort((a, b) => a - b);
}

/** The timeline without the effects of this kind that were added before (by name), and without audio layers left empty. */
export function removeEffects(timeline: Timeline, kind: SoundEffect['kind']): Timeline {
  const name = SFX_NAMES[kind];
  const layers = timeline.layers.flatMap((layer) => {
    if (layer.kind !== 'audio' || !layer.items.some((sound) => sound.name === name)) return [layer];
    const items = layer.items.filter((sound) => sound.name !== name);
    return items.length ? [{ ...layer, items }] : [];
  });
  return { ...timeline, layers };
}

/** One effect at each time, peaking on it. Returns the timeline and how many were placed. */
export function placeEffects(timeline: Timeline, effect: SoundEffect, times: number[], newId: () => string): { timeline: Timeline; placed: number } {
  let next = removeEffects(timeline, effect.kind);
  let placed = 0;
  for (const t of times) {
    const start = Math.max(0, t - effect.peak);
    const cut = start - (t - effect.peak); // The part before the video starts is trimmed off.
    if (effect.duration - cut < 0.05) continue;
    const sound: Sound = { id: newId(), asset_id: effect.asset_id, start: round(start), in: round(cut), out: round(effect.duration), speed: 1, volume: SFX_VOLUME, muted: false,
      fade_in: 0, fade_out: 0, duck: false, name: SFX_NAMES[effect.kind], source_length: effect.duration };
    next = addSound(next, sound, newId());
    placed += 1;
  }
  return { timeline: next, placed };
}
