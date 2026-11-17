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

test('a second pop-out uses the Pop-out layer already there, and applying again replaces the cut-out', () => {
  const once = applyPopout(timeline(), 'a', PICTURES, 'forward', false, 'p', 'pop');
  const twice = applyPopout(once, 'b', { ...PICTURES, backgroundId: 17, personId: 18 }, 'rise', false, 'q', 'pop2');
  assert.deepEqual(twice.layers.map((l) => l.id), ['main', 'pop', 'words']);
  assert.deepEqual(twice.layers[1].items.map((item) => [item.id, item.start]), [['p', 0], ['q', 5]]);
  const again = applyPopout(twice, 'a', { ...PICTURES, personId: 28 }, 'back', false, 'r', 'pop3');
  assert.deepEqual(again.layers.map((l) => l.id), ['main', 'pop', 'words']);
  assert.deepEqual(again.layers[1].items.map((item) => [item.id, item.media_id]), [['r', 28], ['q', 18]]);
});

test('with 8 video layers already, a pop-out still fits on a free Pop-out layer', () => {
  const full = applyPopout(timeline(), 'a', PICTURES, 'forward', false, 'p', 'pop');
  for (let n = 0; n < 6; n++) full.layers.splice(1, 0, { id: `v${n}`, kind: 'video', name: 'Overlay', items: [] });
  assert.equal(full.layers.filter((l) => l.kind === 'video').length, 8);
  const more = applyPopout(full, 'b', PICTURES, 'forward', false, 'q', 'pop2');
  assert.equal(more.layers.filter((l) => l.kind === 'video').length, 8);
  assert.throws(() => applyPopout(full, 'b', PICTURES, 'forward', true, 'q', 'pop2'), /8 video layers/);   // words behind needs a new layer
});

test('Remove pop-out puts the original picture and framing back, and takes the cut-out away', async () => {
  const { removePopout, removeClip } = await import('../src/timeline/model.ts');
  const popped = applyPopout(timeline(), 'a', PICTURES, 'forward', false, 'p', 'pop');
  assert.deepEqual(popped.layers[0].items[0].popout.original_media_id, 1);
  for (const id of ['a', 'p']) {   // from the clip or from its cut-out
    const back = removePopout(popped, id);
    assert.equal(back.layers[0].items[0].media_id, 1);
    assert.deepEqual(back.layers[0].items[0].transform, timeline().layers[0].items[0].transform);
    assert.equal(back.layers[0].items[0].popout, null);
    assert.deepEqual(back.layers.map((l) => l.id), ['main', 'words']);   // the empty Pop-out layer goes too
  }
  // Deleting the cut-out on its own never leaves a background with a hole.
  const deleted = removeClip(popped, 'p');
  assert.equal(deleted.layers[0].items[0].media_id, 1);
  // Deleting the popped clip takes its cut-out with it.
  const gone = removeClip(popped, 'a');
  assert.ok(!gone.layers.some((l) => l.items.some((item) => item.id === 'p')));
  // Making it again keeps the first original, not the previous background.
  const again = applyPopout(popped, 'a', { ...PICTURES, backgroundId: 17, personId: 18 }, 'rise', false, 'q', 'pop2');
  assert.equal(again.layers[0].items[0].popout.original_media_id, 1);
  assert.equal(removePopout(again, 'a').layers[0].items[0].media_id, 1);
});
