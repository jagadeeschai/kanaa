import test from 'node:test';
import assert from 'node:assert/strict';
import { hasZoomReveal, REVEAL_SCALE, zoomReveal } from '../src/timeline/zoom-reveal.ts';
import { valueAt } from '../src/timeline/evaluate.ts';

const title = { id: 't', start: 2, length: 4, text: 'TEXT', style: 'plain', position: 'center', color: '#fff', size: 100, knockout: '#000000', exit: { preset: 'fade', duration: 0.8 },
  transform: { x: 0.5, y: 0.5, scale: 1.8, opacity: 1, rotation: 0, keyframes: { scale: [{ t: 0, v: 1.8, ease: 'easeOut' }, { t: 4, v: 2.05 }] } } };

test('flies into the letter: it stays put on screen while the title grows to fill the frame', () => {
  const hole = { x: 0.62, y: 0.47 };
  const made = zoomReveal(title, hole);
  assert.equal(made.exit, null);
  assert.ok(hasZoomReveal(made) && !hasZoomReveal(title));
  const at = (t) => { const s = valueAt(made.transform, 'scale', t); return [valueAt(made.transform, 'x', t) + (hole.x - 0.5) * s, valueAt(made.transform, 'y', t) + (hole.y - 0.5) * s]; };
  const [sx, sy] = at(2.6);
  for (const t of [2.7, 3.2, 3.6, 3.99]) { const [x, y] = at(t); assert.ok(Math.abs(x - sx) < 1e-3 && Math.abs(y - sy) < 1e-3, `drifted at ${t}`); }
  assert.equal(valueAt(made.transform, 'scale', 4), REVEAL_SCALE);
  // The slow push-in before the flight is kept, and it leads smoothly into it.
  const early = valueAt(made.transform, 'scale', 1), atFlight = valueAt(made.transform, 'scale', 2.6);
  assert.ok(early > 1.8 && early < atFlight && Math.abs(atFlight - valueAt(title.transform, 'scale', 2.6)) < 1e-4);
  assert.deepEqual([valueAt(made.transform, 'opacity', 3.7), valueAt(made.transform, 'opacity', 4)], [1, 0]);
});
