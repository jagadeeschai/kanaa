import test from 'node:test';
import assert from 'node:assert/strict';
import { velocityEvery, velocityRamp } from '../src/timeline/velocity.ts';
import { rampSpeed } from '../src/timeline/ramp.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = { id: 'a', media_id: 4, start: 0, in: 0, out: 4, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
const beats = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];

test('slow on each beat, fast between, a ramp the schema accepts', () => {
  const ramp = velocityRamp(clip, [1, 2, 3], 'punchy');
  assert.ok(ramp.length <= 20 && ramp[0].t === 0 && ramp[ramp.length - 1].t === 1);
  assert.ok(ramp.slice(1).every((point, n) => point.t > ramp[n].t));
  for (const beat of [1, 2, 3]) {
    const u = beat / 4;
    assert.ok(rampSpeed(ramp, u) < rampSpeed(ramp, u + 0.0625), `slower on the beat at ${beat}s than halfway to the next`);
  }
});

test('too few beats, or a reversed clip, gets no velocity ramp', () => {
  assert.equal(velocityRamp(clip, [1], 'smooth'), null);
  assert.equal(velocityRamp(clip, [1, 1.1], 'smooth'), null);  // Too close to ramp between.
  const timeline = { version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [clip, { ...clip, id: 'b', start: 4, reverse: true }] }] };
  assert.deepEqual(velocityEvery(timeline, beats.concat([4.5, 5, 5.5]), 'smooth').map((each) => each.id), ['a']);
});

test('many beats still fit the ramp: every other one is used', () => {
  const long = { ...clip, out: 12 };
  const many = Array.from({ length: 23 }, (_, n) => 0.5 + n * 0.5);
  assert.ok(velocityRamp(long, many, 'smooth').length <= 20);
});
