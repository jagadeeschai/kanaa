import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMatchCut, isUsed, matchCutClips, matchStrength } from '../src/timeline/matchcut.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = (id, media, inn, out, extra = {}) => ({ id, media_id: media, start: 0, in: inn, out, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {}, ...extra });
const timeline = (items) => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items }] });
const cut = { from: 'a', to: 'c', from_at: 4.5, to_at: 1.25, score: 0.9, why: 'same shape', from_picture: '', to_picture: '' };

test('using a match cut trims both clips to the matching frames and puts the second right after the first', () => {
  const before = timeline([clip('a', 1, 0, 6), clip('b', 2, 0, 3), clip('c', 3, 0, 5, { transition_in: { preset: 'fade', duration: 0.5 } })]);
  const after = applyMatchCut(before, cut);
  const items = after.layers[0].items;
  assert.deepEqual(items.map((item) => item.id), ['a', 'c', 'b']);
  assert.equal(items[0].out, 4.533);  // Ends on the matching frame (one frame after it starts).
  assert.equal(items[1].in, 1.25);
  assert.equal(items[1].transition_in, null);  // A plain cut: the match is the transition.
  assert.equal(items[1].start, items[0].start + 4.533);  // Packed right after.
  assert.ok(isUsed(after, cut));
  assert.ok(!isUsed(before, cut));
});

test('a later clip cut into an earlier one moves before it; clips never shrink to nothing', () => {
  const after = applyMatchCut(timeline([clip('c', 3, 0, 5), clip('a', 1, 0, 6)]), cut);
  assert.deepEqual(after.layers[0].items.map((item) => item.id), ['a', 'c']);
  const tiny = applyMatchCut(timeline([clip('a', 1, 4.4, 6), clip('c', 3, 0, 1.3)]), cut);
  assert.ok(tiny.layers[0].items[0].out - tiny.layers[0].items[0].in >= 0.2 - 1e-9);
  assert.ok(tiny.layers[0].items[1].out - tiny.layers[0].items[1].in >= 0.2 - 1e-9);
});

test('only clips that play normally are sent, and strengths read in words', () => {
  const sent = matchCutClips(timeline([clip('a', 1, 0, 6), clip('b', 2, 0, 3, { reverse: true }), clip('c', 3, 1, 5)]), () => true);
  assert.deepEqual(sent, [{ id: 'a', media_id: 1, in: 0, out: 6 }, { id: 'c', media_id: 3, in: 1, out: 5 }]);
  assert.deepEqual([0.9, 0.75, 0.5].map(matchStrength), ['Seamless', 'Strong', 'Worth a look']);
});
