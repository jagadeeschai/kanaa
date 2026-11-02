import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSlideStarts, crossfadeSeconds, slideIndexAt, slideMotion } from '../src/utils/slides.ts';

test('even timing shares the song equally', () => {
  assert.deepEqual(computeSlideStarts(4, 40, 'even', [], []), [0, 10, 20, 30]);
});

test('lyric timing moves cuts to the nearest line', () => {
  const cues = [{ start: 9, end: 12, text: 'a' }, { start: 21, end: 24, text: 'b' }];
  assert.deepEqual(computeSlideStarts(3, 30, 'lyrics', cues, []), [0, 9, 21]);
});

test('beat timing moves cuts to the nearest beat', () => {
  assert.deepEqual(computeSlideStarts(2, 20, 'beats', [], [9.2, 10.4, 15]), [0, 10.4]);
});

test('anchors too far away keep even timing', () => {
  assert.deepEqual(computeSlideStarts(2, 20, 'beats', [], [1]), [0, 10]);
});

test('the image at a moment is the last one started', () => {
  assert.equal(slideIndexAt([0, 5, 10], 4.99), 0);
  assert.equal(slideIndexAt([0, 5, 10], 5), 1);
  assert.equal(slideIndexAt([0, 5, 10], 99), 2);
});

test('neighbouring images move differently', () => {
  assert.notEqual(slideMotion('ken-burns', 0), slideMotion('ken-burns', 1));
});

test('fades shrink to fit the shortest image', () => {
  assert.equal(crossfadeSeconds([0, 10], 20), 0.8);
  assert.equal(crossfadeSeconds([0, 1], 20), 0.5);
  assert.equal(crossfadeSeconds([0], 20), 0);
});
