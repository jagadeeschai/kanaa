/** Enter and exit presets and looks. backend/app/services/animation.py holds the same math. */
export type Preset = 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom' | 'pop' | 'blur' | 'bounce';
export type Animation = { preset: Preset; duration: number };
export type TransitionKind = 'crossfade' | 'wipe' | 'slide' | 'zoom';
export type Transition = { kind: TransitionKind; duration: number };
export type LookName = 'none' | 'warm' | 'cool' | 'mono' | 'vivid' | 'film';
export type Look = { dx: number; dy: number; scale: number; opacity: number; blur: number };

export const MAX_BLUR = 0.03;
const OPACITY_SPAN: Partial<Record<Preset, number>> = { fade: 1, zoom: 1, pop: 1 / 3, blur: 1, bounce: 1 / 3 };
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
  return look;
}

/** How an item looks `local` seconds in. Overlong animations share its length. */
export function animatedLook(enter: Animation | null | undefined, exit: Animation | null | undefined, local: number, length: number): Look {
  const excess = Math.max(1, ((enter?.duration ?? 0) + (exit?.duration ?? 0)) / length);
  const first = enter ? lookAt(enter.preset, local / (enter.duration / excess)) : REST;
  const last = exit ? lookAt(exit.preset, (length - local) / (exit.duration / excess)) : REST;
  return { dx: first.dx + last.dx, dy: first.dy + last.dy, scale: first.scale * last.scale, opacity: first.opacity * last.opacity, blur: Math.max(first.blur, last.blur) };
}
