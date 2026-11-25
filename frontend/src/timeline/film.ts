/** Film physics: halation and handheld shake presets (film_service.py makes the copies; they stack, timeline/stack.ts). */
export const HALATION_PRESETS = [
  { id: 'subtle', label: 'Subtle', about: 'A faint warm glow around the brightest highlights' },
  { id: 'classic', label: 'Classic film', about: 'The red-orange glow film stock gives bright lights and skies' },
  { id: 'dreamy', label: 'Dreamy', about: 'A strong, wide warm glow' },
] as const;
export const SHAKE_PRESETS = [
  { id: 'docu', label: 'Documentary', about: 'A small, steady handheld wobble, like a camera on the shoulder' },
  { id: 'float', label: 'Steadicam float', about: 'A slow, drifting sway' },
  { id: 'impact', label: 'Impact', about: 'A jolt at the start that settles, for a hit or a drop' },
] as const;
