import { describe, expect, it } from 'vitest';
import { betweenNeighbours, moveInlineKeyframe } from '../../src/editor/InlineKeyframes';

const transform = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0, keyframes: { scale: [{ t: 0.5, v: 1 }, { t: 1, v: 1.2 }, { t: 2, v: 1.4 }] } };
const clip = { id: 'a', media_id: 1, start: 0, in: 0, out: 3, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform, adjust: {} };
const timeline = { version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [clip] }] } as never;

describe('dragging an inline keyframe', () => {
  it('stops short of its neighbour instead of merging with it', () => {
    expect(betweenNeighbours(transform as never, 0.5, 1.5)).toBeLessThan(1);
    expect(betweenNeighbours(transform as never, 0.5, 0.2)).toBe(0.2);
  });
  it('keeps every key when a drag passes over another, move by move', () => {
    let current = timeline;
    let dot = { itemId: 'a', kind: 'transform' as const, t: 0.5 };
    for (const to of [0.8, 0.99, 1.0, 1.2, 1.5]) ({ timeline: current, nextDot: dot } = moveInlineKeyframe(current, dot, to) as never);
    const keys = (current as never as { layers: { items: { transform: typeof transform }[] }[] }).layers[0].items[0].transform.keyframes.scale;
    expect(keys.map((key) => key.v)).toEqual([1, 1.2, 1.4]);
    expect(new Set(keys.map((key) => key.t)).size).toBe(3);
  });
});
