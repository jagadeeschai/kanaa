import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, slotPlacement } from '../src/timeline/presets.ts';
import { valueAt } from '../src/timeline/evaluate.ts';
import { dipWeights } from '../src/timeline/animation.ts';
import { emptyTimeline, freezeFrame, insertClip, mainLayer, newClip, splitClip, trimClip } from '../src/timeline/model.ts';
import { buildTokens } from '../src/timeline/words.ts';

const format = { width: 1080, height: 1920, fps: 30 };
const rest = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-3, `${message}: ${a} vs ${b}`);
const video = (id, extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, id), ...extra });

test('push in and pull out run the whole item', () => {
  const pushed = applyMove(rest, 'push-in', 1, 4);
  close(valueAt(pushed, 'scale', 0), 1, 'starts as it was'); close(valueAt(pushed, 'scale', 4), 1.15, 'ends closer');
  const pulled = applyMove(rest, 'pull-out', 1, 4);
  close(valueAt(pulled, 'scale', 0), 1.15, 'starts close'); close(valueAt(pulled, 'scale', 4), 1, 'ends as it was');
});

test('punch in jumps at the playhead and keeps earlier motion', () => {
  const moving = { ...rest, keyframes: { scale: [{ t: 0, v: 1 }, { t: 1, v: 1.1 }] } };
  const punched = applyMove(moving, 'punch-in', 2, 4);
  close(valueAt(punched, 'scale', 0.5), 1.05, 'earlier motion stays');
  close(valueAt(punched, 'scale', 2), 1.1, 'no change before the punch');
  close(valueAt(punched, 'scale', 2.2), 1.375, 'punched in');
  close(valueAt(punched, 'scale', 3.9), 1.375, 'and stays');
});

test('shake wobbles for half a second and returns exactly', () => {
  const shaken = applyMove(rest, 'shake', 1, 4);
  close(valueAt(shaken, 'x', 0.9), 0.5, 'still before');
  close(valueAt(shaken, 'x', 1.6), 0.5, 'back after'); close(valueAt(shaken, 'rotation', 1.6), 0, 'level after'); close(valueAt(shaken, 'scale', 1.6), 1, 'size back');
  assert.ok([1.1, 1.2, 1.3].some((t) => Math.abs(valueAt(shaken, 'x', t) - 0.5) > 0.002), 'it moves while shaking');
  assert.ok(Math.abs(valueAt(shaken, 'x', 1.1) - 0.5) <= 0.015, 'within reach');
});

test('split screen halves fit each clip whole', () => {
  const wide = { width: 1920, height: 1080 };
  const top = slotPlacement(wide, 0, format, 'top');
  assert.deepEqual([top.x, top.y], [0.5, 0.25]);
  close(top.scale, 1, 'a wide clip already fits the top half of a tall frame at full width');
  const left = slotPlacement({ width: 1080, height: 1920 }, 0, { width: 1920, height: 1080, fps: 30 }, 'left');
  close(left.scale, 1, 'a tall clip fills half of a wide frame');
});

test('flash and dip weights match what ffmpeg measured', () => {
  for (const [p, a, b, colour] of [[0.1, 0.45, 0.004, 0.546], [0.5, 0, 0.342, 0.658], [0.9, 0, 0.9, 0.1]]) {
    const [old, fresh, white] = dipWeights(p);
    close(old, a, `old at ${p}`); assert.ok(Math.abs(fresh - b) < 0.006, `new at ${p}`); assert.ok(Math.abs(white - colour) < 0.006, `colour at ${p}`);
  }
});

test('freeze frame holds the playhead frame between the two halves, silently', () => {
  let timeline = insertClip(emptyTimeline(format), video('a', { in: 1, out: 5 }));
  timeline = freezeFrame(timeline, 1.5, ['f', 'b']);
  const clips = mainLayer(timeline).items;
  assert.deepEqual(clips.map((clip) => clip.id), ['a', 'f', 'b']);
  assert.equal(clips[1].freeze, 2.5);
  assert.equal(clips[1].muted, true);
  assert.deepEqual([clips[1].start, clips[2].start], [1.5, 3.5]);
  assert.equal(buildTokens(clips, () => [{ w: 'hi', s: 2.4, e: 2.6 }]).filter((token) => token.clipId === 'f').length, 0);
});

test('a reversed clip splits and trims from its far end', () => {
  let timeline = insertClip(emptyTimeline(format), video('r', { in: 2, out: 6, reverse: true }));
  const split = mainLayer(splitClip(timeline, 1, 's')).items;
  assert.deepEqual(split.map((clip) => [clip.in, clip.out]), [[5, 6], [2, 5]]);
  const trimmedStart = mainLayer(trimClip(timeline, 'r', 'in', 3)).items[0];
  assert.deepEqual([trimmedStart.in, trimmedStart.out], [2, 5]);
  const longerEnd = mainLayer(trimClip(timeline, 'r', 'out', 7, { media_id: 1, media_type: 'video', duration: 10 })).items[0];
  assert.deepEqual([longerEnd.in, longerEnd.out], [1, 6]);
  const frozen = mainLayer(freezeFrame(timeline, 1, ['f', 'b'])).items.find((clip) => clip.id === 'f');
  assert.equal(frozen.freeze, 5);
});

test('putting a title behind the person adds a silent cut-out copy just above the title', async () => {
  const { addText, putBehindPerson } = await import('../src/timeline/model.ts');
  let timeline = insertClip(emptyTimeline(format), video('a', { in: 1, out: 5, volume: 0.8 }));
  timeline = addText(timeline, { id: 't', start: 1, length: 2, text: 'Hi', style: 'band', position: 'center', color: '#ffffff', size: 60 }, 'words');
  const behind = putBehindPerson(timeline, 't', ['p', 'layer']);
  assert.deepEqual(behind.layers.map((layer) => layer.id), ['main', 'words', 'layer']);
  const person = behind.layers[2].items[0];
  assert.deepEqual([person.cutout, person.muted, person.start, person.in, person.out], ['remove', true, 0, 1, 5]);
  assert.equal(putBehindPerson(emptyTimeline(format), 't', ['p', 'l']).layers.length, 1);
});

test('a line along the mountains becomes everything below it, and the title goes behind it', async () => {
  const { addText, groundShape, putBehindShape } = await import('../src/timeline/model.ts');
  assert.deepEqual(groundShape([[0.7, 0.4], [0.2, 0.6]]), [[0, 0.6], [0.2, 0.6], [0.7, 0.4], [1, 0.4], [1, 1], [0, 1]]);
  let timeline = insertClip(emptyTimeline(format), video('a', { in: 1, out: 5 }));
  timeline = addText(timeline, { id: 't', start: 1, length: 2, text: 'Hills', style: 'band', position: 'center', color: '#ffffff', size: 60 }, 'words');
  const mask = { points: groundShape([[0, 0.5], [1, 0.6]]), feather: 0.004 };
  const behind = putBehindShape(timeline, 't', mask, ['f', 'front']);
  assert.deepEqual(behind.layers.map((layer) => layer.id), ['main', 'words', 'front']);
  const front = behind.layers[2].items[0];
  assert.deepEqual([front.shape_mask, front.muted, front.cutout ?? null], [mask, true, null]);
});
