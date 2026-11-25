import test from 'node:test';
import assert from 'node:assert/strict';
import { cannotLook, looksOf, makeLooks, originalPart, setLooks, withLook, withoutLook } from '../src/timeline/stack.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = { id: 'a', media_id: 4, start: 0, in: 2, out: 5, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
const timeline = (item = clip) => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [item] }] });
const lens = { kind: 'lens', preset: 'portrait', strength: 'medium' }, sky = { kind: 'new_sky', sky: 'sunset' };
const mist = { kind: 'atmosphere', preset: 'mist', strength: 'light' }, slow = { kind: 'slowmo', factor: 2 };

test('looks always stack sky, air, lens, slow motion, whatever order they are added in', () => {
  let looks = withLook([], slow);
  looks = withLook(looks, lens); looks = withLook(looks, sky); looks = withLook(looks, mist);
  assert.deepEqual(looks.map((look) => look.kind), ['new_sky', 'atmosphere', 'lens', 'slowmo']);
  assert.deepEqual(withLook(looks, { kind: 'night', mood: 'moonlit' }).map((look) => look.kind), ['new_sky', 'night', 'atmosphere', 'lens', 'slowmo']);  // Night falls after the sky.
  assert.deepEqual(withLook(withLook(looks, { kind: 'rays', preset: 'dusty' }), { kind: 'night', mood: 'dark' }).map((look) => look.kind), ['new_sky', 'night', 'rays', 'atmosphere', 'lens', 'slowmo']);
  assert.deepEqual(withLook(looks, { kind: 'lens', preset: 'dreamy', strength: 'strong' }).filter((look) => look.kind === 'lens')[0].preset, 'dreamy');  // Changed, not doubled.
  assert.deepEqual(withoutLook(looks, 'atmosphere').map((look) => look.kind), ['new_sky', 'lens', 'slowmo']);
});

test('each look is made from the one before, from the original part; slow motion makes it longer', async () => {
  const calls = [];
  let next = 100;
  const made = await makeLooks({ media: 4, start: 2, end: 5 }, [sky, lens, slow], async (look, source) => { calls.push([look.kind, source]); return next++; });
  assert.deepEqual(calls, [['new_sky', { media: 4, start: 2, end: 5 }], ['lens', { media: 100, start: 0, end: 3 }], ['slowmo', { media: 101, start: 0, end: 3 }]]);
  assert.deepEqual(made, { media: 102, seconds: 6 });
  assert.equal(await makeLooks({ media: 4, start: 2, end: 5 }, [], async () => 1), null);
});

test('the clip plays the last copy, every look remembers the original, and the last one off gives it back', () => {
  const part = originalPart(clip);
  const styled = setLooks(timeline(), 'a', part, [sky, lens, slow], { media: 102, seconds: 6 });
  const on = styled.layers[0].items[0];
  assert.deepEqual([on.media_id, on.in, on.out, on.muted], [102, 0, 6, true]);  // Slow motion: silent.
  for (const link of [on.new_sky, on.lens, on.slowmo]) assert.deepEqual([link.original_media_id, link.original_in, link.original_out], [4, 2, 5]);
  assert.equal(on.atmosphere, null);
  assert.deepEqual(looksOf(on).map((look) => look.kind), ['new_sky', 'lens', 'slowmo']);
  assert.deepEqual(originalPart(on), part);
  const lensOnly = setLooks(styled, 'a', part, [lens], { media: 105, seconds: 3 });
  assert.deepEqual([lensOnly.layers[0].items[0].muted, lensOnly.layers[0].items[0].slowmo], [false, null]);  // Sound back with slow motion gone.
  const back = setLooks(styled, 'a', part, [], null).layers[0].items[0];
  assert.deepEqual([back.media_id, back.in, back.out, back.muted, back.lens, back.new_sky, back.slowmo], [4, 2, 5, false, null, null, null]);
});

test('looks need a clip that plays normally', () => {
  assert.equal(cannotLook(clip, 'lens'), null);
  assert.match(cannotLook({ ...clip, reverse: true }, 'lens'), /normally/);
  assert.match(cannotLook({ ...clip, speed: 2 }, 'slowmo'), /normal speed/);
});

test('fine-tuning travels with a look: kept on the clip, read back, and only when something was moved', () => {
  const tunedLens = { ...lens, tune: { amount: 1.6 } };
  const styled = setLooks(timeline(), 'a', originalPart(clip), [sky, tunedLens], { media: 101, seconds: 3 });
  const on = styled.layers[0].items[0];
  assert.deepEqual(on.lens.tune, { amount: 1.6 });
  assert.equal(on.new_sky.tune, null);
  assert.deepEqual(looksOf(on), [sky, tunedLens]);  // Untuned looks carry no empty tuning.
});
