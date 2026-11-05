/**
 * Auto-reframe: a clip fills the frame and pans to keep the main person in the middle, as ordinary x/y keyframes
 * (so it can be adjusted, undone and exported like any other move). The path comes from backend reframe_service.py.
 */
import type { Keyframe, Transform } from './evaluate.ts';
import { clipLength, fillScale, fittedSize, type Clip, type Format } from './model.ts';

/** [source seconds, x, y], x and y from 0 to 1 across the picture. */
export type SubjectPoint = [number, number, number];

const round = (value: number) => Math.round(value * 10000) / 10000;

/** Whether reframing changes anything: the picture's shape differs from the frame's, so part of it is cut off when filling. */
export function canReframe(source: { width: number; height: number }, rotation: number, format: Format): boolean {
  return fillScale(source, rotation, format) > 1.02;
}

/** The clip's new transform, or null when it can't follow (a turned picture, or no subject in this clip's stretch). */
export function reframeTransform(clip: Clip, path: SubjectPoint[], source: { width: number; height: number }, format: Format): Transform | null {
  const rotation = clip.adjust.rotation ?? 0;
  if (rotation % 360) return null;
  const scale = fillScale(source, 0, format);
  const fitted = fittedSize(source, 0, format);
  const shownWidth = fitted.width * scale / format.width;
  const shownHeight = fitted.height * scale / format.height;
  // Where the picture's middle goes so the subject sits in the frame's middle, without uncovering an edge.
  const place = (value: number, shown: number) => Math.min(shown / 2, Math.max(1 - shown / 2, 0.5 - (value - 0.5) * shown));
  const length = clipLength(clip);
  const keys = path.map(([t, x, y]) => ({ local: clip.reverse ? (clip.out - t) / clip.speed : (t - clip.in) / clip.speed, x: place(x, shownWidth), y: place(y, shownHeight) }))
    .filter((point) => point.local >= -1e-6 && point.local <= length + 1e-6)
    .sort((a, b) => a.local - b.local);
  if (!keys.length) return null;
  const track = (axis: 'x' | 'y'): Keyframe[] => {
    const values = keys.map((point) => ({ t: round(point.local), v: round(point[axis]), ease: 'linear' as const }));
    // Drop keys that change nothing, so a still subject gives a still frame.
    return values.filter((key, index) => index === 0 || index === values.length - 1 || Math.abs(key.v - values[index - 1].v) > 1e-4 || Math.abs(key.v - values[index + 1].v) > 1e-4);
  };
  const { x: _x, y: _y, scale: _scale, ...others } = clip.transform.keyframes ?? {};
  const xs = track('x'); const ys = track('y');
  const moving = (keysOf: Keyframe[]) => keysOf.some((key) => Math.abs(key.v - keysOf[0].v) > 1e-4);
  return { ...clip.transform, scale: round(scale), x: xs[0].v, y: ys[0].v,
    keyframes: { ...others, ...(moving(xs) ? { x: xs } : {}), ...(moving(ys) ? { y: ys } : {}) } };
}
