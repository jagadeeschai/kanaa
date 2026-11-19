import test from 'node:test';
import assert from 'node:assert/strict';
import { pathFromStroke } from '../src/timeline/path-draw.ts';
import { valueAt } from '../src/timeline/evaluate.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0, keyframes: { scale: [{ t: 0, v: 1 }, { t: 3, v: 2 }] } };
const arc = Array.from({ length: 200 }, (_, i) => { const a = Math.PI * i / 199; return [0.5 - 0.3 * Math.cos(a), 0.6 - 0.3 * Math.sin(a)]; });

test('a stroke becomes a route from the playhead to the end, along the drawing', () => {
  const made = pathFromStroke(REST, arc, 1, 5);
  assert.equal(made.keyframes.x.length, 16);
  assert.deepEqual([made.keyframes.x[0].t, made.keyframes.x.at(-1).t], [1, 5]);
  assert.ok(Math.abs(valueAt(made, 'x', 1) - 0.2) < 1e-3 && Math.abs(valueAt(made, 'x', 5) - 0.8) < 1e-3);
  // Halfway in time it is at the top of the arc (smooth is symmetric).
  assert.ok(Math.abs(valueAt(made, 'x', 3) - 0.5) < 0.02 && Math.abs(valueAt(made, 'y', 3) - 0.3) < 0.02);
  // Every point lies on the drawn arc.
  for (let t = 1; t <= 5; t += 0.1) assert.ok(Math.abs(Math.hypot(valueAt(made, 'x', t) - 0.5, valueAt(made, 'y', t) - 0.6) - 0.3) < 0.01);
  assert.deepEqual(made.keyframes.scale, REST.keyframes.scale);  // Other moves are kept.
});

test('smooth starts gently; steady keeps one pace; a click is not a path', () => {
  const line = Array.from({ length: 50 }, (_, i) => [0.1 + 0.8 * i / 49, 0.5]);
  const smooth = pathFromStroke(REST, line, 0, 4, 'smooth'), steady = pathFromStroke(REST, line, 0, 4, 'steady');
  assert.ok(valueAt(smooth, 'x', 0.4) < valueAt(steady, 'x', 0.4) - 0.03);
  assert.ok(Math.abs(valueAt(steady, 'x', 2) - 0.5) < 1e-3);
  assert.equal(pathFromStroke(REST, [[0.5, 0.5], [0.501, 0.5]], 0, 4), null);
});
