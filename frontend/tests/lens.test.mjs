import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLens, cannotLens, removeLens } from '../src/timeline/lens.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = { id: 'a', media_id: 4, start: 0, in: 2, out: 5, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
const timeline = { version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [clip] }] };

test('the lens copy plays in place of the part; changing it keeps the first original; remove puts it back', () => {
  const lensed = applyLens(timeline, 'a', 9, 'portrait', 'medium');
  const on = lensed.layers[0].items[0];
  assert.deepEqual([on.media_id, on.in, on.out, on.start], [9, 0, 3, 0]);
  const again = applyLens(lensed, 'a', 11, 'dreamy', 'strong');
  assert.deepEqual([again.layers[0].items[0].lens.original_media_id, again.layers[0].items[0].lens.original_in], [4, 2]);
  assert.deepEqual(removeLens(again, 'a').layers[0].items[0], { ...clip, lens: null });
  assert.ok(cannotLens({ ...clip, reverse: true }));
});
