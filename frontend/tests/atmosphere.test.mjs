import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAtmosphere, cannotAtmosphere, removeAtmosphere } from '../src/timeline/atmosphere.ts';
import { cannotLens } from '../src/timeline/lens.ts';
import { cannotSlow } from '../src/timeline/slowmo.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = { id: 'a', media_id: 4, start: 0, in: 2, out: 5, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
const timeline = { version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [clip] }] };

test('the atmosphere copy plays in place of the part; changing it keeps the first original; remove puts it back', () => {
  const misty = applyAtmosphere(timeline, 'a', 9, 'mist', 'medium');
  const on = misty.layers[0].items[0];
  assert.deepEqual([on.media_id, on.in, on.out, on.atmosphere.preset], [9, 0, 3, 'mist']);
  const again = applyAtmosphere(misty, 'a', 11, 'low-fog', 'heavy');
  assert.deepEqual([again.layers[0].items[0].atmosphere.original_media_id, again.layers[0].items[0].atmosphere.original_in, again.layers[0].items[0].media_id], [4, 2, 11]);
  assert.deepEqual(removeAtmosphere(again, 'a').layers[0].items[0], { ...clip, atmosphere: null });
  assert.equal(removeAtmosphere(timeline, 'a'), timeline);
});

test('atmosphere, lens and slow motion each ask for the others to come off first', () => {
  assert.equal(cannotAtmosphere(clip), null);
  assert.match(cannotAtmosphere({ ...clip, reverse: true }), /plays normally/);
  assert.match(cannotAtmosphere({ ...clip, lens: { original_media_id: 1, original_in: 0, original_out: 1, preset: 'portrait' } }), /lens/);
  const misty = { ...clip, atmosphere: { original_media_id: 1, original_in: 0, original_out: 1, preset: 'mist' } };
  assert.match(cannotLens(misty), /atmosphere/);
  assert.match(cannotSlow(misty), /atmosphere/);
});
