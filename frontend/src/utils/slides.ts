import type { LyricCue } from './lyrics';

export type SlideTiming = 'even' | 'lyrics' | 'beats' | 'storyboard';
export type ImageAnimation = 'none' | 'zoom-in' | 'pan-left' | 'ken-burns';
type Motion = 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';

const FPS = 30;
const CROSSFADE_SECONDS = 0.8;
const KEN_BURNS_MOTIONS: Motion[] = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right'];
// Cuts this close together read as a flicker rather than a change of image.
const MIN_SLIDE_SECONDS = 1;

function nearest(values: number[], target: number, reach: number): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (Math.abs(value - target) <= reach && (best === null || Math.abs(value - target) < Math.abs(best - target))) best = value;
  }
  return best;
}

/**
 * When each image starts. Keeps images roughly equal in length, moving each cut to the
 * nearest lyric line or beat, so the pictures change with the song.
 */
export function computeSlideStarts(count: number, duration: number, timing: SlideTiming, cues: LyricCue[], beats: number[], storyboard: number[] = []): number[] {
  if (count <= 0 || duration <= 0) return [];
  if (timing === 'storyboard' && storyboard.length === count) return storyboard;
  const share = duration / count;
  const anchors = timing === 'lyrics' ? cues.map((cue) => cue.start) : timing === 'beats' ? beats : [];
  const starts = [0];
  for (let index = 1; index < count; index += 1) {
    const even = index * share;
    const snapped = nearest(anchors, even, share / 2) ?? even;
    const earliest = starts[index - 1] + Math.min(MIN_SLIDE_SECONDS, share / 2);
    starts.push(Math.round(Math.max(snapped, earliest) * 1000) / 1000);
  }
  return starts;
}

export function slideIndexAt(starts: number[], position: number): number {
  let index = 0;
  while (index + 1 < starts.length && starts[index + 1] <= position) index += 1;
  return index;
}

export function slideMotion(animation: ImageAnimation, index: number): Motion {
  return animation === 'ken-burns' ? KEN_BURNS_MOTIONS[index % KEN_BURNS_MOTIONS.length] : animation;
}

/** The longest fade every image can give; the export derives the same value. */
export function crossfadeSeconds(starts: number[], duration: number): number {
  if (starts.length < 2) return 0;
  const edges = [...starts, duration].map((time) => Math.round(time * FPS));
  const shortest = Math.min(...edges.slice(1).map((edge, index) => edge - edges[index]));
  return Math.min(Math.round(CROSSFADE_SECONDS * FPS), Math.floor(shortest / 2)) / FPS;
}

/** How one image looks at a moment in the song, as the export's zoompan frames it. */
export function slideTransform(animation: ImageAnimation, index: number, starts: number[], duration: number, fade: number, position: number): string | undefined {
  const start = starts[index] ?? 0;
  const isLast = index >= starts.length - 1;
  const length = (isLast ? duration : starts[index + 1]) - start + (isLast ? 0 : fade);
  const progress = Math.min(1, Math.max(0, (position - start) / (length || 1)));
  const motion = slideMotion(animation, index);
  if (motion === 'zoom-in') return `scale(${1 + 0.12 * progress})`;
  if (motion === 'zoom-out') return `scale(${1.12 - 0.12 * progress})`;
  if (motion === 'pan-left') return `scale(1.12) translateX(${(1 - 2 * progress) * 5.35}%)`;
  if (motion === 'pan-right') return `scale(1.12) translateX(${(2 * progress - 1) * 5.35}%)`;
  return undefined;
}
