import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPopout, popoutMoves } from '../src/timeline/popout.ts';
import { valueAt } from '../src/timeline/evaluate.ts';
import { duration } from '../src/timeline/model.ts';

const FORMAT = { width: 1920, height: 1080, fps: 30 };
const PICTURE = { width: 1536, height: 1024 };  // A 3:2 picture: fitted by height in a 16:9 frame.
const WHERE = { x: 0.55, top: 0.1, bottom: 0.8, left: 0.4, right: 0.7 };
const fw = (1080 * 1.5) / 1920;
/** Where a point of the picture (shares) shows on screen at time t, for a transform. */
const onScreen = (tr, px, py, t) => [valueAt(tr, 'x', t) + (px - 0.5) * fw * valueAt(tr, 'scale', t), valueAt(tr, 'y', t) + (py - 0.5) * valueAt(tr, 'scale', t)];

test('at rest both layers line up exactly, and the person grows from where they stand', () => {
  const [back, front] = popoutMoves('forward', WHERE, PICTURE, FORMAT, 1.2, 5);
  const feet0 = onScreen(front, WHERE.x, WHERE.bottom, 0); const feet5 = onScreen(front, WHERE.x, WHERE.bottom, 5);
  assert.ok(Math.abs(feet0[0] - feet5[0]) < 1e-3 && Math.abs(feet0[1] - feet5[1]) < 1e-3, 'the feet stay put');
  assert.ok(valueAt(front, 'scale', 5) > valueAt(front, 'scale', 0) * 1.2);
  assert.deepEqual(onScreen(back, WHERE.x, WHERE.bottom, 0).map((v) => v.toFixed(3)), feet0.map((v) => v.toFixed(3)));  // Same place at the start.
});

test('dolly zoom: the person keeps their size while the scene pulls away about them', () => {
  const [back, front] = popoutMoves('dolly', WHERE, PICTURE, FORMAT, 1, 4);
  assert.equal(valueAt(front, 'scale', 0), valueAt(front, 'scale', 4));
  assert.ok(valueAt(back, 'scale', 0) > valueAt(back, 'scale', 4));
  const middle = (WHERE.top + WHERE.bottom) / 2;
  const a = onScreen(back, WHERE.x, middle, 0); const b = onScreen(back, WHERE.x, middle, 4);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3);
});

const timeline = () => ({ version: 2, format: FORMAT, layers: [
  { id: 'main', kind: 'video', items: [{ id: 'a', media_id: 1, start: 0, in: 0, out: 5, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, adjust: {} },
    { id: 'b', media_id: 2, start: 5, in: 0, out: 5, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, adjust: {}, transition_in: { kind: 'crossfade', duration: 1 } }] },
  { id: 'words', kind: 'text', items: [] }] });
const PICTURES = { backgroundId: 7, personId: 8, where: WHERE, ...PICTURE };

test('the clip becomes the background, and a new layer holds the person for exactly its time', () => {
  const t = applyPopout(timeline(), 'a', PICTURES, 'forward', false, 'p', 'pop');
  assert.deepEqual(t.layers.map((l) => l.id), ['main', 'pop', 'words']);  // Words in front of the person.
  assert.equal(t.layers[0].items[0].media_id, 7);
  const person = t.layers[1].items[0];
  assert.deepEqual([person.media_id, person.start, person.out, person.muted, person.fade_out], [8, 0, 5, true, 0.5]);  // Fades out over the crossfade.
  assert.equal(duration(t), duration(timeline()));
  assert.deepEqual(applyPopout(timeline(), 'a', PICTURES, 'forward', true, 'p', 'pop').layers.map((l) => l.id), ['main', 'words', 'pop']);  // Words behind.
});
