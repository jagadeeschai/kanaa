import test from 'node:test';
import assert from 'node:assert/strict';
import { hitsFor, pulseFor } from '../src/timeline/beatsync.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = { id: 'a', media_id: 4, start: 10, in: 2, out: 6, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
const beats = [9.5, 10, 10.5, 11, 11.5, 12, 14.2];  // 120 BPM, one missed beat at the end.

test('the beats inside a plain clip become seconds into its part', () => {
  assert.deepEqual(hitsFor(clip, beats), [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(hitsFor({ ...clip, speed: 2, out: 6 }, beats), [0, 1, 2, 3]);  // Twice as fast: 2 s on the timeline, 4 s of the part.
});

test('a clip playing a made copy (with slow motion) maps its beats back into the original part', () => {
  const made = { ...clip, media_id: 50, in: 0, out: 8, slowmo: { original_media_id: 4, original_in: 2, original_out: 6, factor: 2 } };
  assert.deepEqual(hitsFor(made, beats), [0, 0.25, 0.5, 0.75, 1, 2.1]);
});

test('beat pulse takes the song tempo and the clip first beat', () => {
  const base = { strength: 0.6, size: 0.04, bpm: 90, offset: 0 };
  assert.deepEqual(pulseFor({ ...clip, start: 10.2 }, beats, base), { ...base, bpm: 120, offset: 0.3 });
  assert.equal(pulseFor(clip, [], base), null);
});
