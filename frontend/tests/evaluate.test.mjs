import test from 'node:test';
import assert from 'node:assert/strict';
import { animatedLook, lookAt, LOOKS } from '../src/timeline/animation.ts';
import { readFileSync } from 'node:fs';
import { valueAt } from '../src/timeline/evaluate.ts';

const fixture = JSON.parse(readFileSync(new URL('../../timeline/fixtures/keyframes.json', import.meta.url)));
const expected = JSON.parse(readFileSync(new URL('../../timeline/fixtures/keyframes.expected.json', import.meta.url)));

test('keyframes match the values the backend computes', () => {
  for (const [property, values] of Object.entries(expected)) {
    fixture.samples.forEach((t, index) => {
      assert.ok(Math.abs(valueAt(fixture.transform, property, t) - values[index]) < 1e-9, `${property} at ${t}`);
    });
  }
});

test('an unanimated property keeps its value', () => {
  assert.equal(valueAt({ x: 0.4, y: 0.5, scale: 1, opacity: 1 }, 'x', 9), 0.4);
});

const animation = JSON.parse(readFileSync(new URL('../../timeline/fixtures/animation.expected.json', import.meta.url)));

test('presets match the Python math exactly', () => {
  for (const [preset, rows] of Object.entries(animation.presets)) {
    for (const row of rows) {
      const look = lookAt(preset, row.p);
      for (const key of ['dx', 'dy', 'scale', 'opacity', 'blur']) assert.ok(Math.abs(look[key] - row[key]) < 1e-9, `${preset} ${key} at ${row.p}`);
    }
  }
});

test('looks match the Python values', () => { assert.deepEqual(LOOKS, animation.looks); });

test('overlong animations share the item length', () => {
  const look = animatedLook({ preset: 'fade', duration: 3 }, { preset: 'fade', duration: 3 }, 1, 2);
  assert.equal(look.opacity, 1);
});
