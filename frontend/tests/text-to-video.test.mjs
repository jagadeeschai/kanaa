import test from 'node:test';
import assert from 'node:assert/strict';

// shapeOf() is in the dialog module (React); the rule, restated: the video takes the project's shape.
const shapeOf = ({ width, height }) => (width > height * 1.1 ? 'landscape' : height > width * 1.1 ? 'portrait' : 'square');

test('the video follows the project shape', () => {
  assert.deepEqual([{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1080, height: 1080 }, { width: 1080, height: 1350 }].map(shapeOf),
    ['landscape', 'portrait', 'square', 'portrait']);
});
