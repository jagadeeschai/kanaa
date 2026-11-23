import test from 'node:test';
import assert from 'node:assert/strict';
import { applySlow, cannotSlow, removeSlow } from '../src/timeline/slowmo.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = { id: 'a', media_id: 4, start: 0, in: 2, out: 5, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
const timeline = { version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [clip] }] };

test('the slowed copy is factor times longer and silent; changing keeps the first original; normal speed puts it back', () => {
  const slowed = applySlow(timeline, 'a', 9, 4);
  const on = slowed.layers[0].items[0];
  assert.deepEqual([on.media_id, on.in, on.out, on.muted], [9, 0, 12, true]);
  const again = applySlow(slowed, 'a', 11, 2);
  assert.deepEqual([again.layers[0].items[0].out, again.layers[0].items[0].slowmo.original_in], [6, 2]);
  assert.deepEqual(removeSlow(again, 'a').layers[0].items[0], { ...clip, slowmo: null });
  assert.ok(cannotSlow({ ...clip, speed: 0.5 }));
  assert.ok(cannotSlow({ ...clip, lens: { original_media_id: 1, original_in: 0, original_out: 1, preset: 'portrait' } }));
});
