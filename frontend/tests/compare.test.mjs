import test from 'node:test';
import assert from 'node:assert/strict';
import { asShot, comparedTimeline } from '../src/editor/hooks/usePreviewCompare.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const adjust = { rotation: 90, flip_horizontal: true, flip_vertical: false, brightness: 1.4, contrast: 1.2, saturation: 0.5, gamma: 1.1, temperature: 1.3, tint: 0.9, fade: 0.2 };
const clip = { id: 'a', media_id: 9, start: 0, in: 1, out: 3, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust, look: 'warm', old_film: { amount: 1 } };

test('comparing shows the clip as shot: neutral colour (temperature 1, not 0), rotation and flips kept', () => {
  const plain = asShot(clip);
  assert.equal(plain.adjust.temperature, 1);
  assert.equal(plain.adjust.brightness, 1);
  assert.equal(plain.adjust.fade, 0);
  assert.equal(plain.adjust.rotation, 90);
  assert.equal(plain.adjust.flip_horizontal, true);
  assert.equal(plain.look, undefined);
  assert.equal(plain.old_film, null);
});

test('comparing goes back to the original footage under made cinematic copies, lasting just as long', () => {
  const made = { ...clip, media_id: 50, in: 0, out: 4, halation: { original_media_id: 7, original_in: 10, original_out: 12, preset: 'classic' }, slowmo: { original_media_id: 7, original_in: 10, original_out: 12, factor: 2 } };
  const plain = asShot(made);
  assert.equal(plain.media_id, 7);
  assert.deepEqual([plain.in, plain.out, plain.speed], [10, 12, 0.5]);
  assert.equal((plain.out - plain.in) / plain.speed, (made.out - made.in) / made.speed);
  assert.equal(plain.halation, null);
});

test('a hovered look shows only on its clip', () => {
  const timeline = { version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [clip, { ...clip, id: 'b' }] }] };
  const items = comparedTimeline(timeline, false, { clipId: 'b', look: 'mono' }).layers[0].items;
  assert.deepEqual(items.map((each) => each.look), ['warm', 'mono']);
  assert.equal(comparedTimeline(timeline, false, null), timeline);
});
