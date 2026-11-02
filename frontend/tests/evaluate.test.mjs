import test from 'node:test';
import assert from 'node:assert/strict';
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
