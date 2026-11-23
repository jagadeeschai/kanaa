import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneFollow, cloneMoments, cloneTakes, hasClones, removeClones } from '../src/timeline/clone.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = (id, start, inn, out, extra = {}) => ({ id, media_id: 1, start, in: inn, out, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {}, ...extra });
const base = (items) => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items }, { id: 'words', kind: 'text', items: [] }] });
let n = 0; const ids = () => `L${n++}`;

test('follow me: clones from earlier in the clip, oldest lowest, the live person on top, under the words', () => {
  const made = cloneFollow(base([clip('a', 0, 2, 10)]), 'a', 2, 1, ids);
  const names = made.layers.map((layer) => layer.name ?? layer.kind);
  assert.deepEqual(names, [undefined, 'Clone 1', 'Clone 2', 'Clone 3', 'text'].map((name, k) => (k === 0 ? made.layers[0].name ?? 'video' : name)));
  const [two, one, live] = made.layers.slice(1, 4).map((layer) => layer.items[0]);
  assert.deepEqual([two.in, two.out, two.start], [0, 8, 0]);   // 2 s behind.
  assert.deepEqual([one.in, one.out, one.start], [1, 9, 0]);   // 1 s behind.
  assert.deepEqual([live.in, live.out], [2, 10]);
  for (const each of [two, one, live]) assert.deepEqual([each.cutout, each.muted], ['remove', true]);
  assert.ok(hasClones(made, 'a'));
  assert.equal(removeClones(made, 'a').layers.length, 2);
});

test('follow me waits when there is not enough clip before it; again replaces; too many layers is said plainly', () => {
  const made = cloneFollow(base([clip('a', 5, 0.5, 10)]), 'a', 1, 1, ids);
  assert.deepEqual([made.layers[1].items[0].start, made.layers[1].items[0].in], [5.5, 0]);
  assert.equal(cloneFollow(made, 'a', 1, 1, ids).layers.length, made.layers.length);
  assert.throws(() => cloneFollow(base([clip('a', 0, 0, 10)]), 'a', 9, 0.5, ids), /video layers/);
});

test('from my takes: each take cut out over the clip, starting with it, no longer than it', () => {
  const made = cloneTakes(base([clip('a', 0, 0, 6), clip('b', 6, 3, 20), clip('c', 20, 0, 4)]), 'a', [clip('b', 6, 3, 20), clip('c', 20, 0, 4)], ids);
  const [b, c] = made.layers.slice(1, 3).map((layer) => layer.items[0]);
  assert.deepEqual([b.start, b.in, b.out, b.cutout], [0, 3, 9, 'remove']);
  assert.deepEqual([c.start, c.in, c.out], [0, 0, 4]);
});

test('many moments: the clip in parts, all playing at once over the first; remove brings the whole clip back', () => {
  const made = cloneMoments(base([clip('a', 0, 0, 12)]), 'a', 2, ids);
  const main = made.layers[0].items[0];
  assert.deepEqual([main.in, main.out], [0, 4]);
  const parts = made.layers.slice(1, 3).map((layer) => layer.items[0]);
  assert.deepEqual(parts.map((each) => [each.in, each.out, each.start, each.cutout]), [[8, 12, 0, 'remove'], [4, 8, 0, 'remove']]);
  const back = removeClones(made, 'a');
  assert.deepEqual([back.layers.length, back.layers[0].items[0].out], [2, 12]);
  assert.throws(() => cloneMoments(base([clip('a', 0, 0, 2)]), 'a', 4, ids), /too short/);
  const again = cloneMoments(made, 'a', 1, ids);  // Again: from the whole clip, not the shortened one.
  assert.deepEqual([again.layers[0].items[0].out, again.layers.length], [6, 3]);
});
