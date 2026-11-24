import test from 'node:test';
import assert from 'node:assert/strict';
import { angleAt, angleLayers, cannotMulticam, makeMulticam, multicamAt, removeMulticam, switchAngle } from '../src/timeline/multicam.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = (id, media, inn, out, extra = {}) => ({ id, media_id: media, start: 0, in: inn, out, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {}, ...extra });
const timeline = (items, more = []) => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items }, ...more] });
let n = 0; const ids = () => `L${n++}`;
const visible = (made, t) => angleAt(made, 'a', t);

test('angles leave the main track and line up above the main clip, silent and switched off', () => {
  // The main clip plays its recording from 2 s to 12 s. Camera b started 3 s into it; camera c 1.5 s before it.
  const made = makeMulticam(timeline([clip('intro', 9, 0, 4), clip('a', 1, 2, 12), clip('b', 2, 0, 20), clip('c', 3, 0, 20)]), 'a',
    [{ clipId: 'b', offset: 3, duration: 20 }, { clipId: 'c', offset: -1.5, duration: 20 }], ids);
  assert.deepEqual(made.layers[0].items.map((item) => item.id), ['intro', 'a']);
  const [two, three] = angleLayers(made, 'a').map((layer) => layer.items[0]);
  assert.deepEqual([two.start, two.in, two.out], [5, 0, 9]);  // Main second 3 is b's second 0: from 1 s into the clip (4 + 1).
  assert.deepEqual([three.start, three.in, three.out], [4, 3.5, 13.5]);  // Main second 2 is c's 3.5.
  for (const each of [two, three]) assert.deepEqual([each.muted, each.enabled], [true, false]);
  assert.equal(made.layers[1].name, 'Angle 2');
  assert.equal(multicamAt(made, 6)?.id, 'a');
  assert.equal(multicamAt(made, 1), null);
  assert.equal(visible(made, 6), 1);
});

test('switching cuts every angle there and shows the chosen one until the next switch', () => {
  let made = makeMulticam(timeline([clip('a', 1, 0, 10), clip('b', 2, 0, 10), clip('c', 3, 0, 10)]), 'a', [{ clipId: 'b', offset: 0, duration: 10 }, { clipId: 'c', offset: 0, duration: 10 }], ids);
  made = switchAngle(made, 'a', 2, 2);
  made = switchAngle(made, 'a', 5, 3);
  made = switchAngle(made, 'a', 8, 1);
  assert.deepEqual([1, 3, 6, 9].map((t) => visible(made, t)), [1, 2, 3, 1]);
  made = switchAngle(made, 'a', 3, 3);  // A switch inside an earlier stretch: from 3 until the next switch (5).
  assert.deepEqual([2.5, 4, 6].map((t) => visible(made, t)), [2, 3, 3]);
  const items = angleLayers(made, 'a')[0].items;
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);  // Ids stay unique.
  assert.equal(items.reduce((sum, item) => sum + (item.out - item.in), 0), 10);  // Nothing lost in the cuts.
  assert.equal(removeMulticam(made, 'a').layers.length, 1);
});

test('only normal-speed clips can be multicam; clips that never overlap stay on the main track', () => {
  assert.match(cannotMulticam(clip('a', 1, 0, 5, { speed: 2 })), /normal speed/);
  assert.equal(cannotMulticam(clip('a', 1, 0, 5)), null);
  const before = timeline([clip('a', 1, 0, 5), clip('b', 2, 0, 5)]);
  assert.equal(makeMulticam(before, 'a', [{ clipId: 'b', offset: 30, duration: 5 }], ids), before);
});
