/** Enter and exit presets and looks. backend/app/services/animation.py holds the same math. */
export type Preset = 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom' | 'pop' | 'blur' | 'bounce' | 'ground-rise' | 'blast' | 'magic-form' | 'magic-vanish' | 'particle-form' | 'rise-behind' | 'push-through';
export type Animation = { preset: Preset; duration: number };
export type TransitionKind = 'crossfade' | 'wipe' | 'slide' | 'zoom' | 'flash' | 'dip' | 'whip';
export type Transition = { kind: TransitionKind; duration: number };
export type LookName = 'none' | 'warm' | 'cool' | 'mono' | 'vivid' | 'film';
export type Look = { dx: number; dy: number; scale: number; opacity: number; blur: number; tilt?: number };

export const MAX_BLUR = 0.03;
/** Peak sideways blur of a whip, as a share of the frame height. Matches WHIP_BLUR in animation.py. */
export const WHIP_BLUR = 0.05;
const smooth = (low: number, high: number, x: number) => { const t = Math.min(1, Math.max(0, (x - low) / (high - low))); return t * t * (3 - 2 * t); };

/** How much of the old clip, the new one and the flash colour show, `p` of the way through. Measured from ffmpeg's fadewhite and fadeblack. */
export function dipWeights(p: number): [number, number, number] {
  const q = 1 - p; const before = smooth(0.8, 1, q); const after = smooth(0.2, 1, q);
  return [q * before, (1 - q) * (1 - after), q * (1 - before) + (1 - q) * after];
}
const OPACITY_SPAN: Partial<Record<Preset, number>> = { fade: 1, zoom: 1, pop: 1 / 3, blur: 1, bounce: 1 / 3, blast: 0.22, 'magic-form': 0.7, 'magic-vanish': 0.8, 'particle-form': 0.9, 'rise-behind': 0.25, 'push-through': 0.35 };
const SLIDES: Partial<Record<Preset, [number, number]>> = { 'slide-up': [0, 1], 'slide-down': [0, -1], 'slide-left': [1, 0], 'slide-right': [-1, 0] };
export const LOOKS: Record<LookName, [number, number, number, number, number]> = { none: [1, 1, 1, 1, 1], warm: [1.08, 1, 0.9, 1.02, 1.05], cool: [0.92, 1, 1.1, 1.02, 1], mono: [1, 1, 1, 1.1, 0], vivid: [1, 1, 1, 1.1, 1.35], film: [1.03, 1, 0.96, 0.88, 0.85] };
export const REST: Look = { dx: 0, dy: 0, scale: 1, opacity: 1, blur: 0 };

/** The state `p` of the way through a preset: 0 is the hidden end, 1 is at rest. */
export function lookAt(preset: Preset, progress: number): Look {
  const p = Math.min(1, Math.max(0, progress));
  const e = 1 - (1 - p) ** 3;
  const span = OPACITY_SPAN[preset];
  const look = { ...REST, opacity: span ? Math.min(1, p / span) : 1 };
  const slide = SLIDES[preset];
  if (slide) { look.dx = slide[0] * (1 - e); look.dy = slide[1] * (1 - e); }
  else if (preset === 'zoom') look.scale = 0.6 + 0.4 * e;
  else if (preset === 'pop') look.scale = Math.max(0.01, 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2);
  else if (preset === 'blur') look.blur = (1 - e) * MAX_BLUR;
  else if (preset === 'bounce') look.dy = -0.6 * Math.abs(Math.cos(3 * Math.PI * p)) * (1 - p) ** 2;
  else if (preset === 'ground-rise') look.dy = 0.62 * Math.exp(-6 * p) * Math.cos(8 * p);
  else if (preset === 'blast') { look.scale = 1 + 1.25 * Math.exp(-7 * p) * Math.cos(10 * p) * (1 - p); look.blur = 0.018 * (1 - e); }
  else if (preset === 'magic-form') { look.scale = 0.68 + 0.32 * e; look.blur = 0.035 * (1 - e); look.dy = 0.05 * Math.sin(16 * p) * (1 - p); }
  else if (preset === 'magic-vanish') { look.scale = 1.38 - 0.38 * e; look.blur = 0.04 * (1 - e); }
  else if (preset === 'particle-form') { look.scale = 0.9 + 0.1 * e; look.blur = 0.018 * (1 - e); }
  // Cinema reveals, drawn through title3d.ts: `tilt` leans the title back (degrees), in perspective.
  else if (preset === 'rise-behind') { look.dy = 0.45 * (1 - e); look.tilt = 70 * (1 - e); }
  else if (preset === 'push-through') { look.scale = 0.18 + 0.82 * e + 0.08 * Math.sin(Math.PI * p) * e; look.dy = -0.08 * (1 - e); look.tilt = 75 * (1 - e) ** 2; }
  return look;
}

/** How an item looks `local` seconds in. Overlong animations share its length. */
export function animatedLook(enter: Animation | null | undefined, exit: Animation | null | undefined, local: number, length: number): Look {
  const excess = Math.max(1, ((enter?.duration ?? 0) + (exit?.duration ?? 0)) / length);
  const first = enter ? lookAt(enter.preset, local / (enter.duration / excess)) : REST;
  const last = exit ? lookAt(exit.preset, (length - local) / (exit.duration / excess)) : REST;
  return { dx: first.dx + last.dx, dy: first.dy + last.dy, scale: first.scale * last.scale, opacity: first.opacity * last.opacity, blur: Math.max(first.blur, last.blur), tilt: (first.tilt ?? 0) + (last.tilt ?? 0) };
}
