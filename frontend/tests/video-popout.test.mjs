import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVideoPopout, videoPopoutMoves } from '../src/timeline/video-popout.ts';
import { removePopout } from '../src/timeline/model.ts';
import { valueAt } from '../src/timeline/evaluate.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const ADJ = { rotation: 0, flip_horizontal: false, flip_vertical: false, brightness: 1, contrast: 1, saturation: 1, gamma: 1, temperature: 1, tint: 1, fade: 0 };
const clip = { id: 'v', media_id: 5, start: 0, in: 2, out: 8, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: ADJ };
const base = (layers = []) => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [clip] }, { id: 'words', kind: 'text', items: [] }, ...layers] });
const picture = { width: 1920, height: 1080 };

test('the person copy matches the clip at the start, then grows about the person; the scene dims', () => {
  const made = applyVideoPopout(base(), 'v', [2], [0.6, 0.45], picture, 'forward', false, 'p1', 'L1');
  const layer = made.layers.find((each) => each.name === 'Pop-out');
  assert.ok(made.layers.indexOf(layer) < made.layers.findIndex((each) => each.kind === 'text'));  // Words in front.
  const person = layer.items[0];
  assert.deepEqual([person.cutout, person.cutout_pick, person.in, person.out, person.muted], ['remove', { kind: 'people', ids: [2] }, 2, 8, true]);
  for (const property of ['x', 'y', 'scale']) assert.ok(Math.abs(valueAt(person.transform, property, 0) - valueAt(made.layers[0].items[0].transform, property, 0)) < 1e-3);
  // The person's middle stays put on screen while the copy grows.
  const screen = (t) => valueAt(person.transform, 'x', t) + (0.6 - 0.5) * valueAt(person.transform, 'scale', t);
  assert.ok(Math.abs(screen(6) - screen(0)) < 1e-3 && valueAt(person.transform, 'scale', 6) > 1.15);
  const scene = made.layers[0].items[0];
  assert.ok(scene.adjust.brightness < 1 && scene.popout.softened && scene.popout.person_clip_id === 'p1');
  // Remove pop-out puts everything back.
  const back = removePopout(made, 'v');
  assert.deepEqual(back.layers[0].items[0].adjust, ADJ);
  assert.deepEqual(back.layers[0].items[0].transform, REST);
  assert.ok(!back.layers.some((each) => each.name === 'Pop-out'));
});

test('dolly keeps the person the same size while the scene pulls back; quick pop holds after the jump; words behind', () => {
  const [scene, person] = videoPopoutMoves('dolly', [0.5, 0.5], picture, base().format, 1, 4);
  assert.ok(valueAt(scene, 'scale', 0) > valueAt(scene, 'scale', 4));
  assert.equal(valueAt(person, 'scale', 0), valueAt(person, 'scale', 4));
  const [, popped] = videoPopoutMoves('pop', [0.5, 0.5], picture, base().format, 1, 4);
  assert.equal(valueAt(popped, 'scale', 1), valueAt(popped, 'scale', 4));
  const behind = applyVideoPopout(base(), 'v', [1], [0.5, 0.5], picture, 'pop', true, 'p', 'L');
  assert.ok(behind.layers.findIndex((each) => each.name === 'Pop-out') > behind.layers.findIndex((each) => each.kind === 'text'));
  assert.throws(() => applyVideoPopout(base(), 'v', [], [0.5, 0.5], picture, 'pop', false, 'p', 'L'), /Choose who/);
});
