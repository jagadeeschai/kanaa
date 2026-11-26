import test from 'node:test';
import assert from 'node:assert/strict';
import { looksForEvery } from '../src/timeline/lookall.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const base = { media_id: 4, in: 0, out: 2, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
const matched = { original_media_id: 5, original_in: 0, original_out: 2, reference_media_id: 9, reference_in: 0, reference_out: 2 };
const clips = [
  { ...base, id: 'a', start: 0 },
  { ...base, id: 'b', start: 2, media_id: 51, out: 2, colour_match: matched },
  { ...base, id: 'c', start: 4, reverse: true },
  { ...base, id: 'd', start: 6, out: 0.4 },
];
const timeline = { version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: clips }] };
const looks = [{ kind: 'match', reference: { media: 1, start: 0, end: 1 } }, { kind: 'halation', preset: 'classic' }, { kind: 'shake', preset: 'beat', hits: [0.5] }];

test('every clip gets the looks; each keeps its own colour match; reversed clips are left alone', () => {
  const plan = looksForEvery(timeline, looks, [0.5, 1.5, 2.5, 3.5]);
  assert.deepEqual(plan.map((each) => each.clipId), ['a', 'b', 'd']);
  assert.deepEqual(plan[0].looks.map((look) => look.kind), ['halation', 'shake']);
  assert.deepEqual(plan[1].looks.map((look) => look.kind), ['match', 'halation', 'shake']);
  assert.equal(plan[1].looks[0].reference.media, 9);
});

test('shake on the beat takes each clip its own beats, and none where no beat falls', () => {
  const plan = looksForEvery(timeline, looks, [0.5, 1.5, 2.5, 3.5]);
  assert.deepEqual(plan[0].looks[1].hits, [0.5, 1.5]);
  assert.deepEqual(plan[1].looks.find((look) => look.kind === 'shake').hits, [0.5, 1.5]);
  assert.deepEqual(plan[2].looks.map((look) => look.kind), ['halation']);  // 6..6.4 s: no beat, so no shake.
});

test('clips that already have exactly these looks are skipped', () => {
  const done = { ...base, id: 'a', start: 0, media_id: 60, halation: { original_media_id: 4, original_in: 0, original_out: 2, preset: 'classic' } };
  const again = { ...timeline, layers: [{ ...timeline.layers[0], items: [done] }] };
  assert.deepEqual(looksForEvery(again, [{ kind: 'halation', preset: 'classic' }], []), []);
});
