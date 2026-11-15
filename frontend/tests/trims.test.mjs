import test from 'node:test';
import assert from 'node:assert/strict';
import { rollCut, rollRange, slipClip, slipRange } from '../src/timeline/trims.ts';
import { clipLength, duration } from '../src/timeline/model.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = (id, start, inn, out, extra = {}) => ({ id, media_id: 1, start, in: inn, out, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: { ...REST }, adjust: {}, ...extra });
const VIDEO = { media_id: 1, media_type: 'video', duration: 20 };
const IMAGE = { media_id: 1, media_type: 'image' };
const timeline = (items, more = []) => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', items }, ...more] });
const find = (t, id) => t.layers[0].items.find((c) => c.id === id);
const words = { id: 'words', kind: 'text', items: [{ id: 't', start: 6, length: 2, text: 'stays' }] };

test('slip: plays a later part of the source, same place and length, within the source', () => {
  const t = timeline([clip('a', 0, 2, 6), clip('b', 4, 0, 5)]);
  const slipped = slipClip(t, 'a', 3, VIDEO);
  assert.deepEqual([find(slipped, 'a').in, find(slipped, 'a').out, find(slipped, 'a').start], [5, 9, 0]);
  assert.equal(find(slipClip(t, 'a', 100, VIDEO), 'a').out, 20);  // Stops at the source's end.
  assert.equal(find(slipClip(t, 'a', -100, VIDEO), 'a').in, 0);  // And at its start.
  assert.equal(duration(slipped), duration(t));
});

test('slip: pictures and frozen frames do not slip', () => {
  const t = timeline([clip('a', 0, 0, 4), clip('f', 4, 0, 2, { freeze: 1 })]);
  assert.equal(slipClip(t, 'a', 1, IMAGE), t);
  assert.equal(slipClip(t, 'f', 1, VIDEO), t);
  assert.deepEqual(slipRange(find(t, 'a'), IMAGE), [0, 0]);
});

test('roll: one clip longer, the next shorter, the total and everything else unchanged', () => {
  const t = timeline([clip('a', 0, 0, 4), clip('b', 4, 2, 8, { transition_in: { kind: 'crossfade', duration: 0.5 } }), clip('c', 10, 0, 3)], [words]);
  const rolled = rollCut(t, 'a', 'b', 1, VIDEO, VIDEO);
  assert.deepEqual([clipLength(find(rolled, 'a')), find(rolled, 'b').start, find(rolled, 'b').in, clipLength(find(rolled, 'b'))], [5, 5, 3, 5]);
  assert.equal(find(rolled, 'c').start, 10);
  assert.equal(duration(rolled), duration(t));
  assert.deepEqual(rolled.layers[1], t.layers[1]);  // Titles stay put.
  assert.deepEqual(find(rolled, 'b').transition_in, { kind: 'crossfade', duration: 0.5 });
});

test('roll: bounded by the sources and by the shortest a clip may be', () => {
  const t = timeline([clip('a', 0, 0, 4), clip('b', 4, 2, 8)]);
  assert.equal(find(rollCut(t, 'a', 'b', -10, VIDEO, VIDEO), 'b').in, 0);  // b can only start 2 s earlier in its source.
  assert.equal(clipLength(find(rollCut(t, 'a', 'b', -10, VIDEO, VIDEO), 'a')), 2);
  assert.ok(Math.abs(clipLength(find(rollCut(t, 'a', 'b', 10, VIDEO, VIDEO), 'b')) - 0.1) < 1e-9);
  assert.equal(clipLength(find(rollCut(t, 'a', 'b', 10, { ...VIDEO, duration: 6 }, VIDEO), 'a')), 6);  // a's source ends at 6.
});

test('roll: speed and pictures', () => {
  const fast = timeline([clip('a', 0, 0, 8, { speed: 2 }), clip('b', 4, 0, 4)]);
  const rolled = rollCut(fast, 'a', 'b', 1, VIDEO, IMAGE);
  assert.deepEqual([find(rolled, 'a').out, clipLength(find(rolled, 'a')), clipLength(find(rolled, 'b'))], [10, 5, 3]);
});

test('roll: ramps and non-neighbours are left alone; moves stay on the picture', () => {
  const ramped = timeline([clip('a', 0, 0, 4, { ramp: [{ t: 0, speed: 1 }, { t: 1, speed: 2 }] }), clip('b', 4, 0, 4)]);
  assert.equal(rollCut(ramped, 'a', 'b', 1, VIDEO, VIDEO), ramped);
  assert.deepEqual(rollRange(find(ramped, 'a'), find(ramped, 'b'), VIDEO, VIDEO), [0, 0]);
  const t = timeline([clip('a', 0, 0, 4), clip('b', 4, 0, 4), clip('c', 8, 0, 4)]);
  assert.equal(rollCut(t, 'a', 'c', 1, VIDEO, VIDEO), t);
  const keyed = timeline([clip('a', 0, 0, 4), clip('b', 4, 0, 6, { transform: { ...REST, keyframes: { x: [{ t: 0, v: 0.4 }, { t: 4, v: 0.6 }] } } })]);
  assert.deepEqual(find(rollCut(keyed, 'a', 'b', 1, VIDEO, VIDEO), 'b').transform.keyframes.x.map((k) => k.t), [0, 3]);
});
