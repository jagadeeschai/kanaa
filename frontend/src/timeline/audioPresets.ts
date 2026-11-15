/** One-click sound presets. The same numbers as backend/app/services/audio_presets.py (checked by its test). */
export type AudioPresetId = 'remove-rumble' | 'clearer-voice' | 'warmer-music' | 'even-out';
export type AudioStep =
  | { type: 'highpass'; frequency: number }
  | { type: 'peaking'; frequency: number; gain: number; q: number }
  | { type: 'lowshelf' | 'highshelf'; frequency: number; gain: number }
  | { type: 'compressor'; threshold: number; ratio: number; attack: number; release: number; knee: number };

export const AUDIO_PRESETS: { id: AudioPresetId; label: string; about: string; steps: AudioStep[] }[] = [
  { id: 'remove-rumble', label: 'Remove rumble', about: 'Takes out low hum, wind and handling noise.', steps: [{ type: 'highpass', frequency: 80 }] },
  { id: 'clearer-voice', label: 'Clearer voice', about: 'Words stand out: a little more presence, less boom.', steps: [{ type: 'highpass', frequency: 100 }, { type: 'peaking', frequency: 3000, gain: 3, q: 1 }] },
  { id: 'warmer-music', label: 'Warmer music', about: 'A touch more body, softer highs.', steps: [{ type: 'lowshelf', frequency: 200, gain: 2 }, { type: 'highshelf', frequency: 8000, gain: -2 }] },
  { id: 'even-out', label: 'Even out', about: 'Gently brings loud and quiet parts closer.', steps: [{ type: 'compressor', threshold: -18, ratio: 2, attack: 0.02, release: 0.25, knee: 6 }] },
];

/** The steps of the chosen presets, always in the list's order (as preset_filters). */
export const presetSteps = (presets: readonly AudioPresetId[] | null | undefined): AudioStep[] =>
  AUDIO_PRESETS.filter((preset) => presets?.includes(preset.id)).flatMap((preset) => preset.steps);
