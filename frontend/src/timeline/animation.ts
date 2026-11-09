/** Enter and exit presets and looks. backend/app/services/animation.py holds the same math. */
export type Preset = 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom' | 'pop' | 'blur' | 'bounce' | 'ground-rise' | 'blast' | 'magic-form' | 'magic-vanish' | 'particle-form' | 'rise-behind' | 'push-through'
  | 'reveal' | 'soft-edge' | 'line' | 'chromatic' | 'prism' | 'echo' | 'pop-letters' | 'gravity' | 'split' | 'expand' | 'blur-sideways';
export type Animation = { preset: Preset; duration: number };
export type TransitionKind = 'crossfade' | 'wipe' | 'slide' | 'zoom' | 'flash' | 'dip' | 'whip';
export type Transition = { kind: TransitionKind; duration: number };
export type LookName = 'none' | 'warm' | 'cool' | 'mono' | 'vivid' | 'film';
export type Look = { dx: number; dy: number; scale: number; opacity: number; blur: number; tilt?: number } & Partial<PictureLook>;
/**
 * Title picture tricks, drawn in the title's own picture before it is posed (title3d.ts in the preview's TITLE_FRAGMENT,
 * title3d_render.py in the export). reveal: share of the letters shown from the left, with a soft edge `soft` wide (of the
 * letters' width). rise: share shown from the bottom up. line: share of a line under the letters drawn out from the
 * middle, or -1 for none. split: how far apart the copies are, as a share of the letters' height, for `trick`
 * 1 chromatic (red and blue apart), 2 prism (rainbow copies) or 3 echo (fading copies below).
 */
export type PictureLook = { reveal: number; soft: number; rise: number; line: number; split: number; trick: number; streak: number };
export const PICTURE_REST: PictureLook = { reveal: 1, soft: 0, rise: 1, line: -1, split: 0, trick: 0, streak: 0 };
/** A sideways blur's taps either side of the middle, out to three of its widths. Matches STREAK_TAPS in animation.py. */
export const STREAK_TAPS = 8;
/** Presets drawn as picture tricks: such a title goes through the 3D path on both sides. Matches PICTURE_PRESETS in animation.py. */
export const PICTURE_PRESETS = new Set<Preset>(['reveal', 'soft-edge', 'line', 'chromatic', 'prism', 'echo', 'pop-letters', 'gravity', 'split', 'expand', 'blur-sideways']);
/**
 * Letter by letter: each letter (title_letters.py finds them) moves on its own. dx is in widths of the title's letters
 * box, dy in its heights; scale is about the letter's own middle. Pop-up letters and Gravity start one letter after
 * another across LETTER_STAGGER of the animation; Split and Expand move them all together. Matches letter_look in animation.py.
 */
export const LETTER_PRESETS = new Set<Preset>(['pop-letters', 'gravity', 'split', 'expand']);
export const MAX_LETTERS = 64; // Matches title_letters.py.
export const LETTER_STAGGER = 0.6;
export type LetterLook = { dx: number; dy: number; scale: number; opacity: number };
export const LETTER_REST: LetterLook = { dx: 0, dy: 0, scale: 1, opacity: 1 };

/** Letter `index` of `count`, whose middle is `u` widths of the letters box from its middle, `progress` of the way through. */
export function letterLook(preset: Preset, progress: number, index: number, count: number, u: number): LetterLook {
  if (!LETTER_PRESETS.has(preset)) return LETTER_REST;
  const p = Math.min(1, Math.max(0, progress));
  const staggered = preset === 'pop-letters' || preset === 'gravity';
  const k = staggered && count > 1 ? Math.min(1, Math.max(0, (p - (LETTER_STAGGER * index) / (count - 1)) / (1 - LETTER_STAGGER))) : p;
  const e = 1 - (1 - k) ** 3;
  if (preset === 'pop-letters') return { dx: 0, dy: 0, scale: Math.max(0.01, 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2), opacity: Math.min(1, k * 3) };
  if (preset === 'gravity') return { dx: 0, dy: -1.4 * Math.abs(Math.cos(3 * Math.PI * k)) * (1 - k) ** 2, scale: 1, opacity: Math.min(1, k * 4) };
  if (preset === 'split') return { dx: u * 1.2 * (1 - e), dy: 0, scale: 1, opacity: Math.min(1, k * 2.5) };
  return { dx: -u * 0.85 * (1 - e), dy: 0, scale: 1, opacity: Math.min(1, k * 2) };
}

/** Every letter's look `local` seconds in, enter and exit together (offsets add, scale and opacity multiply). */
export function letterLooks(enter: Animation | null | undefined, exit: Animation | null | undefined, local: number, length: number, us: number[]): LetterLook[] {
  const excess = Math.max(1, ((enter?.duration ?? 0) + (exit?.duration ?? 0)) / length);
  return us.map((u, index) => {
    const a = enter ? letterLook(enter.preset, local / (enter.duration / excess), index, us.length, u) : LETTER_REST;
    const b = exit ? letterLook(exit.preset, (length - local) / (exit.duration / excess), index, us.length, u) : LETTER_REST;
    return { dx: a.dx + b.dx, dy: a.dy + b.dy, scale: a.scale * b.scale, opacity: a.opacity * b.opacity };
  });
}
/** Copies in a prism or an echo, and how far beyond the letters (in letter heights) the tricks may reach. */
export const TRICK_COPIES = 4;
export const TRICK_MARGIN = 1.25;
const LINE_DRAW = 0.45; const RISE_FROM = 0.35;

export const MAX_BLUR = 0.03;
/** Peak sideways blur of a whip, as a share of the frame height. Matches WHIP_BLUR in animation.py. */
export const WHIP_BLUR = 0.05;
const smooth = (low: number, high: number, x: number) => { const t = Math.min(1, Math.max(0, (x - low) / (high - low))); return t * t * (3 - 2 * t); };

/** How much of the old clip, the new one and the flash colour show, `p` of the way through. Measured from ffmpeg's fadewhite and fadeblack. */
export function dipWeights(p: number): [number, number, number] {
  const q = 1 - p; const before = smooth(0.8, 1, q); const after = smooth(0.2, 1, q);
  return [q * before, (1 - q) * (1 - after), q * (1 - before) + (1 - q) * after];
}
const OPACITY_SPAN: Partial<Record<Preset, number>> = { fade: 1, zoom: 1, pop: 1 / 3, blur: 1, bounce: 1 / 3, blast: 0.22, 'magic-form': 0.7, 'magic-vanish': 0.8, 'particle-form': 0.9, 'rise-behind': 0.25, 'push-through': 0.35, chromatic: 0.4, prism: 0.4, echo: 0.5, 'blur-sideways': 0.6 };
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
  // Cinema reveals, drawn through title3d.ts. Rise descends gently, then settles onto a floor plane instead of
  // standing upright; the smooth cubic has zero velocity at the landing, avoiding the old snap/flicker.
  else if (preset === 'rise-behind') { look.dy = -0.32 * (1 - e); look.tilt = 68 * e; }
  else if (preset === 'push-through') { look.scale = 0.18 + 0.82 * e + 0.08 * Math.sin(Math.PI * p) * e; look.dy = -0.08 * (1 - e); look.tilt = 75 * (1 - e) ** 2; }
  // Picture tricks (PictureLook). A wipe across the letters, hard or soft; a line drawn out, then the letters rising from it;
  // colour copies or fading copies that close in on the letters.
  else if (preset === 'reveal') Object.assign(look, { reveal: e, soft: 0.04 });
  else if (preset === 'soft-edge') Object.assign(look, { reveal: p * p * (3 - 2 * p), soft: 0.35 });
  else if (preset === 'line') {
    const drawn = Math.min(1, p / LINE_DRAW); const risen = Math.min(1, Math.max(0, (p - RISE_FROM) / (1 - RISE_FROM)));
    Object.assign(look, { line: 1 - (1 - drawn) ** 3, rise: 1 - (1 - risen) ** 3 });
  }
  else if (preset === 'chromatic') Object.assign(look, { split: 0.35 * (1 - e), trick: 1 });
  else if (preset === 'prism') Object.assign(look, { split: 0.3 * (1 - e), trick: 2 });
  else if (preset === 'echo') Object.assign(look, { split: 0.8 * (1 - e), trick: 3 });
  // A sideways blur, its width a share of the letters' height, easing to sharp.
  else if (preset === 'blur-sideways') Object.assign(look, { streak: 0.3 * (1 - e) });
  return look;
}

/** How an item looks `local` seconds in. Overlong animations share its length. */
export function animatedLook(enter: Animation | null | undefined, exit: Animation | null | undefined, local: number, length: number): Look {
  const excess = Math.max(1, ((enter?.duration ?? 0) + (exit?.duration ?? 0)) / length);
  const first = enter ? lookAt(enter.preset, local / (enter.duration / excess)) : REST;
  const last = exit ? lookAt(exit.preset, (length - local) / (exit.duration / excess)) : REST;
  return { dx: first.dx + last.dx, dy: first.dy + last.dy, scale: first.scale * last.scale, opacity: first.opacity * last.opacity, blur: Math.max(first.blur, last.blur), tilt: (first.tilt ?? 0) + (last.tilt ?? 0), ...pictureLook(first, last) };
}

/** Enter and exit picture tricks together: the less shown wins, a line is drawn by whichever has one, the wider copies win. */
export function pictureLook(first: Partial<PictureLook>, last: Partial<PictureLook>): PictureLook {
  const a = { ...PICTURE_REST, ...first }; const b = { ...PICTURE_REST, ...last };
  const line = a.line < 0 ? b.line : b.line < 0 ? a.line : Math.min(a.line, b.line);
  const copies = b.split > a.split ? b : a;
  return { reveal: Math.min(a.reveal, b.reveal), soft: Math.max(a.soft, b.soft), rise: Math.min(a.rise, b.rise), line, split: copies.split, trick: copies.split > 0 ? copies.trick : Math.max(a.trick, b.trick), streak: Math.max(a.streak, b.streak) };
}
