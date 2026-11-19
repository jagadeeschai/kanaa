import test from 'node:test';
import assert from 'node:assert/strict';
import { barShares } from '../src/timeline/model.ts';

test('bar sizes match the export (finish_service.bar_shares)', () => {
  const cases = [[[1920, 1080, null], [0, 0.12808]], [[1920, 1080, 1.85], [0, 0.01952]], [[1920, 1080, 4 / 3], [0.125, 0]], [[1080, 1920, 1], [0, 0.21875]], [[1080, 1920, null], [0, 0]]];
  for (const [[width, height, ratio], expected] of cases) assert.deepEqual(barShares({ width, height }, ratio).map((value) => Math.round(value * 1e5) / 1e5), expected);
});
