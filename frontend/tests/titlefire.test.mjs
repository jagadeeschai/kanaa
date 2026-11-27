import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRE_LAYER, fireOf, withTitleFire, withoutTitleFire } from '../src/timeline/titlefire.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const title = { id: 't1', start: 2, length: 10, text: 'உடனே விழி தமிழா!', style: 'shadow', position: 'center', color: '#ffffff', size: 44, transform: REST };
const other = { ...title, id: 't2', start: 8 };
const base = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [] }, { id: 'text', kind: 'text', items: [title, other] }] });

test('the fire loop repeats under the title from its start to its end, on a Screen layer above the main track', () => {
  const lit = withTitleFire(base(), title, 70, 4, 'blaze');
  const layer = lit.layers[1];
  assert.equal(layer.id, FIRE_LAYER); assert.equal(layer.blend, 'screen');
  assert.deepEqual(layer.items.map((clip) => [clip.start, clip.out]), [[2, 4], [6, 4], [10, 2]]);
  assert.equal(layer.items[0].fade_in, 0.5); assert.equal(layer.items[2].fade_out, 0.6);
  assert.deepEqual(fireOf(lit, 't1'), { strength: 'blaze', media: 70 });
});

test('setting it again replaces the fire; putting it out removes the layer once empty', () => {
  const lit = withTitleFire(withTitleFire(base(), title, 70, 4, 'blaze'), title, 71, 4, 'inferno');
  assert.deepEqual(fireOf(lit, 't1'), { strength: 'inferno', media: 71 });
  assert.equal(lit.layers.filter((layer) => layer.id === FIRE_LAYER).length, 1);
  const out = withoutTitleFire(lit, 't1');
  assert.equal(out.layers.some((layer) => layer.id === FIRE_LAYER), false);
  assert.equal(fireOf(out, 't1'), null);
});

test('two burning titles at the same time are refused, not overlapped', () => {
  const lit = withTitleFire(base(), title, 70, 4, 'blaze');
  assert.throws(() => withTitleFire(lit, other, 72, 4, 'glow'), /already on fire/);
});
