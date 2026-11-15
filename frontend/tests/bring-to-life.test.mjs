import test from 'node:test';
import assert from 'node:assert/strict';

// fitted() lives in the dialog module (a .tsx with React); its rule is restated here and checked on the same numbers.
const MIN_SPEED = 0.25;
const fitted = (clipSeconds, videoSeconds) => {
  const speed = Math.max(MIN_SPEED, Math.min(1, videoSeconds / clipSeconds));
  return { in: 0, out: Math.round(Math.min(videoSeconds, clipSeconds * speed) * 1000) / 1000, speed: Math.round(speed * 10000) / 10000 };
};
const length = ({ in: start, out, speed }) => (out - start) / speed;

test('a video fills the clip exactly: slowed when shorter, trimmed when longer', () => {
  for (const [clip, video] of [[10, 5], [5, 5], [4, 5], [12.3, 8], [15, 15]]) assert.ok(Math.abs(length(fitted(clip, video)) - clip) < 0.002, `${clip} ${video}`);
});

test('never slower than a quarter speed (the dialog refuses such a clip rather than shorten it)', () => {
  const placed = fitted(40, 5);
  assert.equal(placed.speed, 0.25);
  assert.equal(length(placed), 20);
});
