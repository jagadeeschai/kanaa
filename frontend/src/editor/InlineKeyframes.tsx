import { valueAt, type AnimatedProperty, type Keyframe, type Transform } from '../timeline/evaluate';
import { isFollowed, keyTimes, SAME_KEY_SECONDS } from '../timeline/keyframes';
import { clipLength, type Clip, type Timeline } from '../timeline/model';
import type { RampPoint } from '../timeline/ramp';

export type InlineKeyframeDot =
  | { itemId: string; kind: 'transform'; t: number }
  | { itemId: string; kind: 'ramp'; t: number; rampIndex: number };

const round = (value: number) => Math.round(value * 1000) / 1000;
const KEYFRAME_Y_OFFSET = 7;
const HIT_RADIUS = 7;

export function sameInlineKeyframe(a: InlineKeyframeDot | null, b: InlineKeyframeDot | null): boolean {
  if (!a || !b || a.itemId !== b.itemId || a.kind !== b.kind) return false;
  if (a.kind === 'ramp' && b.kind === 'ramp') return a.rampIndex === b.rampIndex;
  return Math.abs(a.t - b.t) <= SAME_KEY_SECONDS;
}

export function collectInlineKeyframes(
  itemId: string,
  length: number,
  transform?: Transform,
  ramp?: RampPoint[] | null,
): InlineKeyframeDot[] {
  const dots: InlineKeyframeDot[] = [];
  if (transform && !isFollowed(transform)) {
    for (const t of keyTimes(transform)) {
      if (t >= 0 && t <= length) dots.push({ itemId, kind: 'transform', t });
    }
  }
  if (ramp?.length) {
    ramp.forEach((point, rampIndex) => {
      if (point.t > 0 && point.t < 1) {
        dots.push({ itemId, kind: 'ramp', t: round(point.t * length), rampIndex });
      }
    });
  }
  return dots;
}

export function drawInlineKeyframes(
  context: CanvasRenderingContext2D,
  dots: InlineKeyframeDot[],
  selected: InlineKeyframeDot | null,
  x: number,
  bottom: number,
  zoom: number,
  colors: { head: string; selected: string; ramp?: string },
): void {
  const cy = bottom - KEYFRAME_Y_OFFSET;
  for (const dot of dots) {
    const cx = x + dot.t * zoom;
    const isSelected = sameInlineKeyframe(dot, selected);
    context.save();
    context.fillStyle = isSelected ? colors.selected : dot.kind === 'ramp' ? (colors.ramp ?? '#f59e0b') : colors.head;
    if (dot.kind === 'ramp') {
      context.beginPath();
      context.arc(cx, cy, isSelected ? 4.5 : 3.5, 0, Math.PI * 2);
      context.fill();
    } else {
      const r = isSelected ? 5 : 4;
      context.beginPath();
      context.moveTo(cx, cy - r);
      context.lineTo(cx + r, cy);
      context.lineTo(cx, cy + r);
      context.lineTo(cx - r, cy);
      context.closePath();
      context.fill();
    }
    if (isSelected) {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.5;
      context.stroke();
    }
    context.restore();
  }
}

export function hitTestInlineKeyframe(
  dots: InlineKeyframeDot[],
  pointerX: number,
  pointerY: number,
  clipX: number,
  bottom: number,
  zoom: number,
): InlineKeyframeDot | null {
  const cy = bottom - KEYFRAME_Y_OFFSET;
  if (Math.abs(pointerY - cy) > HIT_RADIUS) return null;
  let best: InlineKeyframeDot | null = null;
  let bestDist = HIT_RADIUS;
  for (const dot of dots) {
    const cx = clipX + dot.t * zoom;
    const dist = Math.abs(pointerX - cx);
    if (dist <= bestDist) {
      bestDist = dist;
      best = dot;
    }
  }
  return best;
}

function updateTransformTime(transform: Transform, oldT: number, newT: number): Transform {
  const keyframes: Partial<Record<AnimatedProperty, Keyframe[]>> = { ...transform.keyframes };
  for (const [prop, keys] of Object.entries(keyframes) as [AnimatedProperty, Keyframe[] | undefined][]) {
    if (!keys?.length) continue;
    const moved = keys
      .map((k) => (Math.abs(k.t - oldT) <= SAME_KEY_SECONDS ? { ...k, t: round(newT) } : k))
      .sort((a, b) => a.t - b.t);
    keyframes[prop] = moved;
  }
  return { ...transform, keyframes };
}

/** `wanted`, kept between the dragged key's neighbours (in every property it has a key in), so it never lands on one
 *  and merges with it. */
export function betweenNeighbours(transform: Transform, from: number, wanted: number): number {
  let low = -Infinity, high = Infinity;
  for (const keys of Object.values(transform.keyframes ?? {}) as (Keyframe[] | undefined)[]) {
    if (!keys?.some((key) => Math.abs(key.t - from) <= SAME_KEY_SECONDS)) continue;
    for (const key of keys) {
      if (Math.abs(key.t - from) <= SAME_KEY_SECONDS) continue;
      if (key.t < from) low = Math.max(low, key.t); else high = Math.min(high, key.t);
    }
  }
  const gap = 2 * SAME_KEY_SECONDS;
  return round(Math.min(high - gap, Math.max(low + gap, wanted)));
}

function removeTransformAt(transform: Transform, targetT: number): Transform {
  let next: Transform = { ...transform, keyframes: { ...transform.keyframes } };
  for (const [prop, keys] of Object.entries(next.keyframes ?? {}) as [AnimatedProperty, Keyframe[] | undefined][]) {
    if (!keys?.length) continue;
    const remaining = keys.filter((k) => Math.abs(k.t - targetT) > SAME_KEY_SECONDS);
    if (remaining.length) {
      next = { ...next, keyframes: { ...next.keyframes, [prop]: remaining } };
    } else {
      const value = valueAt(next, prop, targetT);
      const updatedKeyframes = { ...next.keyframes };
      delete updatedKeyframes[prop];
      next = { ...next, keyframes: updatedKeyframes, [prop]: value };
    }
  }
  return next;
}

export function moveInlineKeyframe(
  timeline: Timeline,
  dot: InlineKeyframeDot,
  newLocalTime: number,
): { timeline: Timeline; nextDot: InlineKeyframeDot } {
  let nextDot: InlineKeyframeDot = dot;
  const nextTimeline: Timeline = {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.kind === 'audio') return layer;
      return {
        ...layer,
        items: layer.items.map((item) => {
          if (item.id !== dot.itemId) return item;
          const length = 'length' in item ? item.length : clipLength(item as Clip);
          const clamped = round(Math.max(0, Math.min(length, newLocalTime)));
          if (dot.kind === 'transform' && 'transform' in item && item.transform) {
            const t = betweenNeighbours(item.transform, dot.t, clamped);
            nextDot = { ...dot, t };
            return { ...item, transform: updateTransformTime(item.transform, dot.t, t) };
          }
          if (dot.kind === 'ramp' && 'ramp' in item && item.ramp?.length) {
            const clip = item as Clip;
            const u = Math.max(0.01, Math.min(0.99, length > 0 ? clamped / length : 0.5));
            const updated = clip.ramp!.map((p, idx) => (idx === dot.rampIndex ? { ...p, t: round(u) } : p));
            const targetPoint = updated[dot.rampIndex];
            const sorted = [...updated].sort((a, b) => a.t - b.t);
            const newIndex = sorted.indexOf(targetPoint);
            nextDot = { itemId: dot.itemId, kind: 'ramp', t: round(targetPoint.t * length), rampIndex: newIndex };
            return { ...clip, ramp: sorted };
          }
          return item;
        }) as typeof layer.items,
      };
    }) as Timeline['layers'],
  };
  return { timeline: nextTimeline, nextDot };
}

export function deleteInlineKeyframe(timeline: Timeline, dot: InlineKeyframeDot): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.kind === 'audio') return layer;
      return {
        ...layer,
        items: layer.items.map((item) => {
          if (item.id !== dot.itemId) return item;
          if (dot.kind === 'transform' && 'transform' in item && item.transform) {
            return { ...item, transform: removeTransformAt(item.transform, dot.t) };
          }
          if (dot.kind === 'ramp' && 'ramp' in item && item.ramp && item.ramp.length > 2) {
            return { ...item, ramp: item.ramp.filter((_, idx) => idx !== dot.rampIndex) };
          }
          return item;
        }) as typeof layer.items,
      };
    }) as Timeline['layers'],
  };
}
