import test from 'node:test';
import assert from 'node:assert/strict';
import { addFreeze3d, cannotFreeze3d, changeFreeze3d, freezePoint } from '../src/timeline/freeze3d.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = (id, media, inn, out, extra = {}) => ({ id, media_id: media, start: 0, in: inn, out, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {}, ...extra });
const timeline = (items) => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items }] });

test('a time freeze holds the moment and plays the made video there, between the two halves', () => {
  const before = timeline([clip('a', 4, 1, 9)]);
  assert.deepEqual(freezePoint(before, 3).at, 4);  // Timeline second 3 is the recording's second 4.
  const made = addFreeze3d(before, 3, 77, 'orbit-right', 3, ['f', 'b']);
  const items = made.layers[0].items;
  assert.deepEqual(items.map((item) => [item.id, item.start, item.in, item.out]), [['a', 0, 1, 4], ['f', 3, 0, 3], ['b', 6, 4, 9]]);
  assert.equal(items[1].media_id, 77);
  assert.equal(items[1].freeze, null);
  assert.deepEqual(items[1].freeze3d, { original_media_id: 4, at: 4, move: 'orbit-right' });
  assert.equal(freezePoint(made, 4), null);  // Not inside a freeze again.
  const changed = changeFreeze3d(made, 'f', 78, 'push-in');
  assert.deepEqual([changed.layers[0].items[1].media_id, changed.layers[0].items[1].freeze3d.move, changed.layers[0].items[1].out], [78, 'push-in', 3]);
});

test('it needs a clip under the playhead that is not already a still', () => {
  assert.match(cannotFreeze3d(null), /playhead/);
  assert.match(cannotFreeze3d(clip('a', 4, 0, 2, { freeze: 1 })), /still/);
  const empty = timeline([]);
  assert.equal(addFreeze3d(empty, 1, 77, 'rise', 3, ['f', 'b']), empty);
});
