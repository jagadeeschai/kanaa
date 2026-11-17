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

test('focus drift pushes in on the subject, moves it towards the middle and never shows an edge', async () => {
  const { applyMove } = await import('../src/timeline/presets.ts');
  const { valueAt } = await import('../src/timeline/evaluate.ts');
  const rest = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0, keyframes: {} };
  const aim = { x: 0.8, y: 0.3 };
  const moved = applyMove(rest, 'focus-drift', 0, 6, aim, 1, 1);
  const [s0, s1] = [valueAt(moved, 'scale', 0), valueAt(moved, 'scale', 6)];
  assert.ok(s1 > s0 * 1.15, 'pushes in');
  for (const t of [0, 1.5, 3, 4.5, 6]) {
    const scale = valueAt(moved, 'scale', t);
    for (const axis of ['x', 'y']) {
      const value = valueAt(moved, axis, t);
      assert.ok(value - scale / 2 <= 1e-6 && value + scale / 2 >= 1 - 1e-6, `${axis} covers the frame at ${t}s`);
    }
  }
  // The subject's point of the picture, followed to the end: nearer the middle than it started.
  const at = (axis, t) => valueAt(moved, axis, t) + (aim[axis] - valueAt(moved, axis, 0)) * valueAt(moved, 'scale', t) / s0;
  assert.ok(Math.abs(at('x', 6) - 0.5) < Math.abs(aim.x - 0.5), 'x drifts to the middle');
  assert.ok(Math.abs(at('y', 6) - 0.5) < Math.abs(aim.y - 0.5), 'y drifts to the middle');
  const none = applyMove(rest, 'focus-drift', 0, 6, null, 1, 1);
  assert.deepEqual(none, applyMove(rest, 'ken-burns', 0, 6, null, 1, 1), 'without a subject it is a Ken Burns');
});
