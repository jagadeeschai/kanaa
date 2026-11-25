/** Real motion blur: the presets (blur_service.py makes the copy; it stacks with the other looks, timeline/stack.ts). */
export type BlurPreset = 'natural' | 'dreamy' | 'action';
export const BLUR_PRESETS: { id: BlurPreset; label: string; about: string }[] = [
  { id: 'natural', label: 'Natural film', about: 'The classic cinema smear (a 180° shutter): movement flows, still parts stay sharp' },
  { id: 'dreamy', label: 'Dreamy smear', about: 'Long, soft streaks of movement (a 360° shutter)' },
  { id: 'action', label: 'Crisp action', about: 'Just a touch of smear (a 90° shutter), for fast action that stays sharp' },
];
