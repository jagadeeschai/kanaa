import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, focusOnScreen } from '../src/timeline/presets.ts';
import { valueAt } from '../src/timeline/evaluate.ts';
import { splitAtCuts } from '../src/timeline/scenes.ts';
import { placeEffect, EFFECT_LAYER, decodePayload, encodePayload, dropHint } from '../src/timeline/drop.ts';
import { clipLength, emptyTimeline, insertClip, mainLayer, newClip, overlayLayers, addOverlay } from '../src/timeline/model.ts';

const rest = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-3, `${message}: ${a} vs ${b}`);
const portrait = { width: 1080, height: 1920, fps: 30 };

test('a face in the picture is placed on screen, kept inside the frame', () => {
  // A portrait photo filling a portrait frame: picture and screen share coordinates.
  const point = focusOnScreen(rest, { x: 0.7, y: 0.3 }, { width: 1080, height: 1920 }, 0, portrait);
  close(point.x, 0.7, 'x'); close(point.y, 0.3, 'y');
  const edge = focusOnScreen(rest, { x: 0.99, y: 0.01 }, { width: 1080, height: 1920 }, 0, portrait);
  assert.deepEqual([edge.x, edge.y], [0.92, 0.08]);
  assert.equal(focusOnScreen(rest, { x: 0.5, y: 0.5 }, { width: 1080, height: 1920 }, 90, portrait), null);
});

test('push in aims at the face: it stays put on screen while the picture grows', () => {
  const aim = { x: 0.7, y: 0.3 };
  const moved = applyMove(rest, 'push-in', 0, 4, aim);
  for (const t of [0, 2, 4]) {
    const scale = valueAt(moved, 'scale', t);
    // Where the picture point under the aim shows at time t: it should not move.
    const pictureX = 0.5 + (aim.x - 0.5) / 1; // At rest, the aim's offset from the middle.
    close(valueAt(moved, 'x', t) + (pictureX - 0.5) * scale, aim.x, `x at ${t}s`);
  }
  close(valueAt(moved, 'scale', 4), 1.15, 'grows');
  const out = applyMove(rest, 'pull-out', 0, 4, aim);
  close(valueAt(out, 'x', 4), 0.5, 'pull out ends at rest');
  close(valueAt(out, 'x', 0), valueAt(moved, 'x', 4), 'and starts where push in ends');
  // Without an aim, only the size changes, as before.
  assert.equal(applyMove(rest, 'push-in', 0, 4).keyframes.x, undefined);
});

test('scene changes split a clip once each, in one change', () => {
  const video = { media_id: 1, media_type: 'video', duration: 30 };
  let ids = 0; const newId = () => `n${ids += 1}`;
  let t = insertClip(emptyTimeline(portrait), { ...newClip(video, 'a'), out: 4 });
  t = insertClip(t, { ...newClip(video, 'b'), in: 10, out: 20 });
  const { timeline, splits } = splitAtCuts(t, 'b', [5, 12, 15.5, 25], newId);
  assert.equal(splits, 2, 'only cuts inside the clip');
  assert.deepEqual(mainLayer(timeline).items.map((clip) => [clip.in, clip.out]), [[0, 4], [10, 12], [12, 15.5], [15.5, 20]]);
  const reversed = insertClip(emptyTimeline(portrait), { ...newClip(video, 'r'), in: 10, out: 20, reverse: true });
  const back = splitAtCuts(reversed, 'r', [12], newId);
  assert.equal(back.splits, 1);
  close(clipLength(mainLayer(back.timeline).items[0]), 8, 'source 20 → 12 plays first');
});

test('effects go on their own Screen layer, shared while they do not overlap', () => {
  const video = { media_id: 1, media_type: 'video', duration: 5, width: 720, height: 1280 };
  let t = insertClip(emptyTimeline(portrait), newClip({ media_id: 2, media_type: 'video', duration: 20 }, 'main'));
  t = addOverlay(t, { ...newClip(video, 'logo'), start: 0 }, 'overlay');
  t = placeEffect(t, { ...newClip(video, 'fx1'), start: 0 }, 'fx');
  t = placeEffect(t, { ...newClip(video, 'fx2'), start: 6 }, 'fx-2');
  t = placeEffect(t, { ...newClip(video, 'fx3'), start: 2 }, 'fx-3');
  const layers = overlayLayers(t);
  assert.deepEqual(layers.map((layer) => [layer.name, layer.blend ?? 'normal', layer.items.map((clip) => clip.id)]),
    [['Overlay', 'normal', ['logo']], [EFFECT_LAYER, 'screen', ['fx1', 'fx2']], [EFFECT_LAYER, 'screen', ['fx3']]]);
  const payload = { kind: 'effect', effect: 'petals' };
  assert.deepEqual(decodePayload(encodePayload(payload)), payload);
  assert.equal(dropHint(t, payload, { zone: 'above', time: 1, clipId: null }), 'Add effect here');
  let full = t;
  assert.throws(() => { for (let i = 0; i < 6; i += 1) full = placeEffect(full, { ...newClip(video, `x${i}`), start: 2 }, `l${i}`); }, /video layers/);
});
