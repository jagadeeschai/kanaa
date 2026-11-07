import { CINEMATIC, mainLayer, type Finish, type Timeline } from './model.ts';
import type { LookName } from './animation.ts';

/**
 * One-click cinematic looks. Each is only a combination of settings the export already understands —
 * the whole-video finish, a per-clip look and no LUT — so preview and export agree without new render code.
 * Applying a preset is one timeline change, so one Undo restores what was there.
 */
export type CinematicPreset = { id: string; label: string; about: string; finish: Finish; look: LookName };

export const CINEMATIC_PRESETS: CinematicPreset[] = [
  { id: 'teal-orange', label: 'Teal & orange film', about: 'Widescreen bars, the cinema grade, a soft glow and fine grain.', finish: { ...CINEMATIC, letterbox: true }, look: 'film' },
  { id: 'golden-hour', label: 'Golden hour', about: 'Warm and glowing, like the last light of the day.', finish: { letterbox: false, grade: 0.3, glow: 0.45, vignette: 0.35, grain: 0.2 }, look: 'warm' },
  { id: 'night-city', label: 'Night city', about: 'Cool and contrasty with deep edges and strong grain.', finish: { letterbox: true, grade: 0.5, glow: 0.1, vignette: 0.75, grain: 0.5 }, look: 'cool' },
  { id: 'mono-classic', label: 'Black & white classic', about: 'Monochrome with grain, vignette and cinema bars.', finish: { letterbox: true, grade: 0, glow: 0, vignette: 0.45, grain: 0.55 }, look: 'mono' },
  { id: 'clean-doc', label: 'Clean documentary', about: 'A gentle grade only: no bars, no grain.', finish: { letterbox: false, grade: 0.25, glow: 0.1, vignette: 0.1, grain: 0 }, look: 'none' },
];

/** Turns a preset off: no finish and the Original look on every main-track clip. */
export function clearCinematicPreset(timeline: Timeline): Timeline {
  const main = mainLayer(timeline);
  return {
    ...timeline,
    finish: null,
    layers: timeline.layers.map((layer) => (layer === main ? { ...main, items: main.items.map((clip) => ({ ...clip, look: 'none' as LookName })) } : layer)),
  };
}

/** Which preset the timeline currently matches, if any: the same finish, no LUT, and one look on every main-track clip. */
export function activeCinematicPreset(timeline: Timeline): CinematicPreset | null {
  const finish = timeline.finish;
  if (!finish || timeline.lut) return null;
  const look = mainLayer(timeline).items[0]?.look ?? 'none';
  const uniform = mainLayer(timeline).items.every((clip) => (clip.look ?? 'none') === look);
  if (!uniform) return null;
  return CINEMATIC_PRESETS.find((preset) => preset.look === look && JSON.stringify(preset.finish) === JSON.stringify(finish)) ?? null;
}

/** Applies a preset: the finish over the whole film, the look on every main-track clip, and any LUT taken off. */
export function applyCinematicPreset(timeline: Timeline, preset: CinematicPreset): Timeline {
  const main = mainLayer(timeline);
  return {
    ...timeline,
    finish: { ...preset.finish },
    lut: null,
    layers: timeline.layers.map((layer) => (layer === main ? { ...main, items: main.items.map((clip) => ({ ...clip, look: preset.look })) } : layer)),
  };
}
