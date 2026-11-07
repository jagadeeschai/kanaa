import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { corners, homography, is3d, layers, poseAt } from '../src/timeline/title3d.ts';

// Made by tools/title3d_fixture.py from backend/app/services/title3d.py: the preview must put every corner where the export does.
const fixture = JSON.parse(readFileSync(new URL('./title3d-cases.json', import.meta.url), 'utf8'));
const close = (got, want, within, label) => assert.ok(Math.abs(got - want) <= within, `${label}: ${got} vs ${want}`);

test('corners and homographies match the export, case by case', () => {
  for (const [index, item] of fixture.cases.entries()) {
    const got = corners(item.pose, fixture.box, fixture.size, item.share, item.amount, item.pin);
    got.forEach(([x, y], k) => { close(x, item.corners[k][0], 0.01, `case ${index} corner ${k} x`); close(y, item.corners[k][1], 0.01, `case ${index} corner ${k} y`); });
    const source = [[fixture.box[0], fixture.box[1]], [fixture.box[2], fixture.box[1]], [fixture.box[2], fixture.box[3]], [fixture.box[0], fixture.box[3]]];
    homography(source, got).flat().forEach((value, k) => close(value, item.homography.flat()[k], 1e-6 + Math.abs(item.homography.flat()[k]) * 1e-6, `case ${index} matrix ${k}`));
  }
});

test('poses through the cinema presets match the export', () => {
  for (const item of fixture.looks) {
    const text = { id: 't', start: 0, length: 3, text: 'x', style: 'band', position: 'bottom', color: '#ffffff', size: 44, enter: { preset: item.preset, duration: 1.2 }, exit: { preset: 'fade', duration: 0.5 },
      transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0, tilt_x: 10, keyframes: { tilt_y: [{ t: 0, v: 30, ease: 'linear' }, { t: 2, v: -10, ease: 'linear' }] } } };
    const { pose, look } = poseAt(text, item.local);
    for (const key of Object.keys(item.pose)) close(pose[key], item.pose[key], 1e-9, `${item.preset} at ${item.local}: ${key}`);
    close(look.opacity, item.opacity, 1e-9, `${item.preset} at ${item.local}: opacity`);
  }
});

test('a flat title stays on the flat path, and depth makes more layers', () => {
  const flat = { id: 't', start: 0, length: 2, text: 'x', style: 'band', position: 'bottom', color: '#fff', size: 44 };
  assert.equal(is3d(flat), false);
  assert.equal(is3d({ ...flat, enter: { preset: 'rise-behind', duration: 1 } }), true);
  assert.equal(is3d({ ...flat, depth: { amount: 0, color: '#000000', light: 0.5 } }), false);
  assert.deepEqual(layers(null), [0]);
  assert.equal(layers({ amount: 1, color: '#000000', light: 0.5 }).length, 15);
});
