import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove } from '../src/timeline/presets.ts';
import { valueAt } from '../src/timeline/evaluate.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const edgeSafe = (transform, wide, t) => {
  // The picture's left and right edges on screen stay outside the frame.
  const half = (valueAt(transform, 'scale', t) * wide) / 2; const x = valueAt(transform, 'x', t);
  return x - half <= 0 && x + half >= 1;
};

test('a pan travels across the whole clip, the picture moving the other way on screen', () => {
  const right = applyMove(REST, 'pan-right', 0, 6);
  assert.ok(valueAt(right, 'x', 0) > valueAt(right, 'x', 6));
  const left = applyMove(REST, 'pan-left', 0, 6);
  assert.ok(valueAt(left, 'x', 0) < valueAt(left, 'x', 6));
});

test('pans and Ken Burns never show an edge, even for a narrower photo', () => {
  for (const wide of [1, 0.84, 0.5625]) {
    for (const preset of ['pan-right', 'pan-left', 'ken-burns']) {
      const moved = applyMove(REST, preset, 0, 5, null, wide);
      for (const t of [0, 1.25, 2.5, 3.75, 5]) assert.ok(edgeSafe(moved, wide, t), `${preset} ${wide} at ${t}`);
    }
  }
});

test('Ken Burns pushes in while it drifts', () => {
  const moved = applyMove(REST, 'ken-burns', 0, 5);
  assert.ok(valueAt(moved, 'scale', 5) > valueAt(moved, 'scale', 0));
  assert.notEqual(valueAt(moved, 'x', 0), valueAt(moved, 'x', 5));
});
