import test from 'node:test';
import assert from 'node:assert/strict';
import { animatedLook, lookAt, LOOKS } from '../src/timeline/animation.ts';
import { keyChroma, keyKind, toHex } from '../src/timeline/chroma.ts';
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
      for (const key of Object.keys(row).filter((name) => name !== 'p')) assert.ok(Math.abs(look[key] - row[key]) < 1e-9, `${preset} ${key} at ${row.p}`);
    }
  }
});

test('ground rise starts below the frame and settles at the title position', () => {
  assert.equal(lookAt('ground-rise', 0).dy, 0.62);
  assert.ok(Math.abs(lookAt('ground-rise', 0.5).dy) < 0.04);
  assert.ok(Math.abs(lookAt('ground-rise', 1).dy) < 0.002);
});

test('blast and magic titles begin transformed and settle cleanly', () => {
  assert.ok(lookAt('blast', 0).scale > 2);
  assert.ok(lookAt('magic-form', 0).blur > 0.03);
  assert.ok(lookAt('magic-vanish', 0).scale > 1.3);
  assert.ok(lookAt('particle-form', 0).blur > 0);
  for (const preset of ['blast', 'magic-form', 'magic-vanish', 'particle-form']) {
    const end = lookAt(preset, 1);
    assert.ok(Math.abs(end.scale - 1) < 1e-6);
    assert.ok(Math.abs(end.blur) < 1e-6);
  }
});

test('looks match the Python values', () => { assert.deepEqual(LOOKS, animation.looks); });

test('overlong animations share the item length', () => {
  const look = animatedLook({ preset: 'fade', duration: 3 }, { preset: 'fade', duration: 3 }, 1, 2);
  assert.equal(look.opacity, 1);
});

test('the key colour matches the export, in limited-range BT.709', () => {
  const [u, v] = keyChroma('#00b140');
  assert.equal(Math.round(u * 255), 96);
  assert.equal(Math.round(v * 255), 55);
});

test('blue screens use blue spill removal, and picked colours become hex', () => {
  assert.equal(keyKind('#00b140'), 1);
  assert.equal(keyKind('#0047bb'), 2);
  assert.equal(toHex([0, 177.4, 64]), '#00b140');
});

test('a path with a key on every frame counts as followed, a few hand-placed keys do not', async () => {
  const { isFollowed, FOLLOWED_KEYS } = await import('../src/timeline/keyframes.ts');
  const keys = (n) => Array.from({ length: n }, (_, i) => ({ t: i / 30, v: 0.5 }));
  const transform = (n) => ({ x: 0.5, y: 0.5, scale: 1, opacity: 1, keyframes: { x: keys(n), y: keys(n) } });
  assert.equal(isFollowed(transform(3)), false);
  assert.equal(isFollowed(transform(FOLLOWED_KEYS + 1)), true);
  assert.equal(isFollowed({ x: 0.5, y: 0.5, scale: 1, opacity: 1 }), false);
});

test('each letter moves as the Python letter_look says', async () => {
  const { letterLook } = await import('../src/timeline/animation.ts');
  for (const [preset, rows] of Object.entries(animation.letters)) {
    for (const row of rows) {
      const look = letterLook(preset, row.p, row.index, row.count, row.u);
      for (const key of ['dx', 'dy', 'scale', 'opacity']) assert.ok(Math.abs(look[key] - row[key]) < 1e-9, `${preset} ${key} at ${row.p} letter ${row.index}`);
    }
  }
});

test('circle transitions weigh the old clip as xfade does: open from the middle, close from the edges', async () => {
  const { circleWeight } = await import('../src/timeline/animation.ts');
  assert.equal(circleWeight('circle-open', 0, 0), 1, 'all old at the start');
  assert.equal(circleWeight('circle-open', 1, 1), 0, 'all new at the end');
  assert.ok(circleWeight('circle-open', 0, 0.5) < circleWeight('circle-open', 1, 0.5), 'new in the middle first');
  assert.equal(circleWeight('circle-close', 1, 0), 1);
  assert.equal(circleWeight('circle-close', 0, 1), 0);
  assert.ok(circleWeight('circle-close', 1, 0.5) < circleWeight('circle-close', 0, 0.5), 'new at the edges first');
});
