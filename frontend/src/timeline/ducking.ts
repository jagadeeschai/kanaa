/** Auto-duck: how a ducked sound dips under the other sound, the same rule as backend auto_ducking.py. */
import type { Sound } from './model.ts';

export const DUCK_PRESETS = {
  light: { threshold: -26, depth: 6, fade: 0.4 },
  medium: { threshold: -30, depth: 12, fade: 0.3 },
  strong: { threshold: -34, depth: 18, fade: 0.2 },
} as const;

/** The music's settled gain while the other sound peaks at `peak`: auto_ducking.duck_gain (the export's rule). */
export function duckGain(peak: number, thresholdDb: number, depthDb: number): number {
  return peak > 10 ** (thresholdDb / 20) ? 10 ** (-Math.max(0, depthDb) / 20) : 1;
}

/** How a ducked sound dips: its preset with any fine-tuning over it (null: the original gentle dip). */
export function duckSettings(sound: Sound): { threshold: number; depth: number; fade: number } | null {
  if (!sound.duck || !sound.duck_preset) return null;
  const preset = DUCK_PRESETS[sound.duck_preset];
  return { threshold: sound.duck_threshold ?? preset.threshold, depth: sound.duck_depth ?? preset.depth, fade: sound.duck_fade ?? preset.fade };
}

