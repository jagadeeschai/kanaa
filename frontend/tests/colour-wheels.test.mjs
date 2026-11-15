import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyWheels, wheelVectors, WHEEL_PRESETS } from '../src/timeline/colourWheels.ts';

const near = (a, b, label) => { for (const key of ['lift', 'gamma', 'gain']) a[key].forEach((v, k) => assert.ok(Math.abs(v - b[key][k]) < 1e-5, `${label} ${key}`)); };
const fixture = JSON.parse(readFileSync(new URL('../../timeline/fixtures/wheels.expected.json', import.meta.url)));

test('the same vectors and curves as colour_wheels.py', () => {
  for (const [name, { wheels, vectors, out }] of Object.entries(fixture.cases)) {
    const v = wheelVectors(wheels);
    near(v, vectors, name);
    for (const channel of [0, 1, 2]) fixture.samples.forEach((x, k) => assert.ok(Math.abs(applyWheels(x, channel, v) - out[channel][k]) < 1e-5, `${name} ${channel} ${x}`));
  }
});

test('the one-click presets are the backend presets, and Reset clears', () => {
  for (const preset of WHEEL_PRESETS.filter((entry) => entry.wheels)) near(wheelVectors(preset.wheels), fixture.cases[preset.id].vectors, preset.id);
  assert.equal(wheelVectors(WHEEL_PRESETS.find((entry) => entry.id === 'reset').wheels), null);
});
