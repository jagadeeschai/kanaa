import test from 'node:test';
import assert from 'node:assert/strict';
import { onTheSkyline, SINK } from '../src/timeline/skyline.ts';
import { valueAt } from '../src/timeline/evaluate.ts';

test('the letters rest on the horizon at each moment, dipping a little behind it', () => {
  const box = [0.3, 0.42, 0.7, 0.58];  // Letters at rest: bottom at 0.58 of the frame.
  const made = onTheSkyline({ x: 0.6, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, box, [0, 1, 2], [0.33, null, 0.4]);
  const bottom = (t) => valueAt(made, 'y', t) + (box[3] - 0.5);
  assert.ok(Math.abs(bottom(0) - (0.33 + SINK * 0.16)) < 1e-4);
  assert.ok(Math.abs(bottom(2) - (0.4 + SINK * 0.16)) < 1e-4);
  assert.equal(made.x, 0.6);
  assert.equal(onTheSkyline(undefined, box, [0, 1], [null, null]), null);
});
