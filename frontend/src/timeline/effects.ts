import type { Clip, Timeline } from './model.ts';
import { RAMPS } from './ramp.ts';

/**
 * A clip's effects, each of which can be switched off without losing its settings (`clip.bypass`), so the clip can be
 * compared with and without it. A switched-off effect is left out of the preview and the export alike:
 * backend/app/services/timeline_service.py applies the same rules (apply_bypass) before compiling.
 */
export type EffectId = 'look' | 'colour' | 'old_film' | 'signal_damage' | 'lens_surface' | 'background' | 'green_screen' | 'steady' | 'reverse' | 'speed_effect' | 'motion' | 'enter_exit' | 'transition' | 'clean_voice';
export type ActiveEffect = { id: EffectId; label: string; detail: string; on: boolean };

const RAMP_NAMES: Record<string, string> = Object.fromEntries(Object.entries(RAMPS).map(([name, ramp]) => [JSON.stringify(ramp), name.replace('-', ' ')]));
const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const keyCount = (clip: Clip) => Object.values(clip.transform.keyframes ?? {}).reduce((sum, keys) => Math.max(sum, keys?.length ?? 0), 0);

/** The effects this clip has, in the order a person thinks of them, each with whether it is on. */
export function clipEffects(clip: Clip): ActiveEffect[] {
  const off = new Set(clip.bypass ?? []);
  const list: Omit<ActiveEffect, 'on'>[] = [];
  if (clip.look && clip.look !== 'none') list.push({ id: 'look', label: 'Look', detail: title(clip.look) });
  if (clip.adjust.brightness !== 1 || clip.adjust.contrast !== 1 || clip.adjust.saturation !== 1) list.push({ id: 'colour', label: 'Colour', detail: 'adjusted' });
  if (clip.old_film) list.push({ id: 'old_film', label: 'Old film', detail: 'grain, scratches and weave' });
  if (clip.signal_damage) list.push({ id: 'signal_damage', label: 'Signal damage', detail: clip.signal_damage.mode === 'vhs' ? 'VHS tape' : 'digital glitch' });
  if (clip.lens_surface) list.push({ id: 'lens_surface', label: 'Lens surface', detail: clip.lens_surface.mode === 'raindrops' ? 'raindrops' : 'lens dirt' });
  if (clip.cutout) list.push({ id: 'background', label: 'Background', detail: clip.cutout === 'blur' ? `${title(clip.blur_amount ?? 'medium')} blur${clip.focus_pull ? ', focus pull' : ''}` : 'removed' });
  if (clip.chroma) list.push({ id: 'green_screen', label: 'Green screen', detail: 'colour removed' });
  if (clip.stabilise) list.push({ id: 'steady', label: 'Steady', detail: 'shake smoothed' });
  if (clip.reverse) list.push({ id: 'reverse', label: 'Backwards', detail: 'plays in reverse' });
  if (clip.ramp) list.push({ id: 'speed_effect', label: 'Speed effect', detail: title(RAMP_NAMES[JSON.stringify(clip.ramp)] ?? 'custom') });
  if (keyCount(clip)) list.push({ id: 'motion', label: 'Animation', detail: `${keyCount(clip)} ${keyCount(clip) === 1 ? 'point' : 'points'}` });
  if (clip.enter || clip.exit) list.push({ id: 'enter_exit', label: 'Enter and exit', detail: [clip.enter?.preset, clip.exit?.preset].filter(Boolean).join(', ') });
  if (clip.transition_in) list.push({ id: 'transition', label: 'Transition in', detail: title(clip.transition_in.kind) });
  if (clip.clean_voice) list.push({ id: 'clean_voice', label: 'Clean voice', detail: 'noise removed' });
  return list.map((effect) => ({ ...effect, on: !off.has(effect.id) }));
}

/** The clip as it plays: switched-off effects left out, everything else as set. */
export function applyBypass(clip: Clip): Clip {
  const off = clip.bypass;
  if (!off?.length) return clip;
  const next: Clip = { ...clip };
  for (const id of off) {
    if (id === 'look') next.look = 'none';
    if (id === 'colour') next.adjust = { ...next.adjust, brightness: 1, contrast: 1, saturation: 1 };
    if (id === 'old_film') next.old_film = null;
    if (id === 'signal_damage') next.signal_damage = null;
    if (id === 'lens_surface') next.lens_surface = null;
    if (id === 'background') Object.assign(next, { cutout: null, cutout_pick: null, focus_pull: null });
    if (id === 'green_screen') next.chroma = null;
    if (id === 'steady') next.stabilise = false;
    if (id === 'reverse') next.reverse = false;
    if (id === 'speed_effect') next.ramp = null;
    if (id === 'motion') { const { keyframes: _keys, ...still } = next.transform; next.transform = still; }
    if (id === 'enter_exit') Object.assign(next, { enter: null, exit: null });
    if (id === 'transition') next.transition_in = null;
    if (id === 'clean_voice') next.clean_voice = false;
  }
  return next;
}

/** The whole timeline as it plays. */
export function playingTimeline(timeline: Timeline): Timeline {
  if (!timeline.layers.some((layer) => layer.kind === 'video' && layer.items.some((clip) => clip.bypass?.length))) return timeline;
  return { ...timeline, layers: timeline.layers.map((layer) => (layer.kind === 'video' ? { ...layer, items: layer.items.map(applyBypass) } : layer)) };
}

/** Switches one effect on or off, keeping its settings. */
export function toggleEffect(clip: Clip, id: EffectId): Partial<Clip> {
  const off = new Set(clip.bypass ?? []);
  if (off.has(id)) off.delete(id); else off.add(id);
  return { bypass: off.size ? [...off] : null };
}

/** Switches every effect off, or back on when all are already off. */
export function toggleAllEffects(clip: Clip): Partial<Clip> {
  const effects = clipEffects(clip);
  return { bypass: effects.every((effect) => !effect.on) ? null : effects.map((effect) => effect.id) };
}

/** Removes an effect for good (undo brings it back), clearing its switch too. */
export function removeEffect(clip: Clip, id: EffectId): Partial<Clip> {
  const stripped = applyBypass({ ...clip, bypass: [id] });
  const rest = (clip.bypass ?? []).filter((item) => item !== id);
  const changes: Partial<Clip> = { bypass: rest.length ? rest : null };
  for (const key of ['look', 'adjust', 'old_film', 'signal_damage', 'lens_surface', 'cutout', 'cutout_pick', 'focus_pull', 'chroma', 'stabilise', 'reverse', 'ramp', 'transform', 'enter', 'exit', 'transition_in', 'clean_voice'] as const) {
    if (stripped[key] !== clip[key]) (changes as Record<string, unknown>)[key] = stripped[key];
  }
  return changes;
}
