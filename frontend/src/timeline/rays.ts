/** God rays: the presets (rays_service.py makes the copy; it stacks with the other looks, timeline/stack.ts). */
export type RaysPreset = 'soft' | 'strong' | 'dusty';
export const RAYS_PRESETS: { id: RaysPreset; label: string; about: string }[] = [
  { id: 'soft', label: 'Soft glow', about: 'Gentle beams fanning from the sun' },
  { id: 'strong', label: 'Strong beams', about: 'Bold shafts of light streaming across the scene' },
  { id: 'dusty', label: 'Dusty light', about: 'Warm golden beams, like sun through dust' },
];
