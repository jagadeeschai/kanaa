import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftLyricCues, stretchLyricCues } from '../src/utils/lyrics.ts';

const cues = [0, 10, 20, 30, 40].map((start, i) => ({ start, end: start + 4, text: `line ${i + 1}` }));

test('shift moves only the chosen lines, inside the song', () => {
  const next = shiftLyricCues(cues, 1, 2, 0.5, 60);
  assert.deepEqual(next.map((c) => c.start), [0, 10.5, 20.5, 30, 40]);
  assert.equal(shiftLyricCues(cues, 0, 4, -3, 60)[0].start, 0);
});

test('stretch places the two lines and spreads the ones between', () => {
  // Lyrics drift: line 1 is right at 0, line 5 is really sung at 44 instead of 40.
  const next = stretchLyricCues(cues, 0, 4, 0, 44, 60);
  assert.deepEqual(next.map((c) => c.start), [0, 11, 22, 33, 44]);
  assert.equal(next[2].end, 26.4);
});

test('stretch with one line is a shift', () => {
  assert.deepEqual(stretchLyricCues(cues, 2, 2, 21, 21, 60).map((c) => c.start), [0, 10, 21, 30, 40]);
});
