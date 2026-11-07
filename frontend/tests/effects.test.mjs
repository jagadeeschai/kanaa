import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, slotPlacement } from '../src/timeline/presets.ts';
import { valueAt } from '../src/timeline/evaluate.ts';
import { dipWeights } from '../src/timeline/animation.ts';
import { emptyTimeline, freezeFrame, snapshotFrame, insertClip, mainLayer, newClip, splitClip, trimClip } from '../src/timeline/model.ts';
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

test('snapshot freeze adds an editable flash and printed-photo pose', () => {
  const timeline = insertClip(emptyTimeline(format), video('a', { in: 1, out: 5 }));
  const clips = mainLayer(snapshotFrame(timeline, 1.5, ['photo', 'after'])).items;
  assert.equal(clips[1].freeze, 2.5);
  assert.deepEqual(clips[1].transition_in, { kind: 'flash', duration: 0.24 });
  assert.equal(clips[1].transform.scale, 0.9);
  assert.equal(clips[1].transform.rotation, -2);
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

test('ground rise works behind either people or objects without duplicating its foreground', async () => {
  const { addText, groundRiseBehind } = await import('../src/timeline/model.ts');
  let timeline = insertClip(emptyTimeline(format), video('a', { in: 1, out: 5 }));
  timeline = addText(timeline, { id: 't', start: 1, length: 2, text: 'Mission', style: 'outline', position: 'center', color: '#ffffff', size: 80 }, 'words');
  const people = groundRiseBehind(timeline, 't', 'person', ['p', 'people']);
  assert.equal(people.layers[1].items[0].enter.preset, 'ground-rise');
  assert.deepEqual([people.layers[2].name, people.layers[2].items[0].cutout], ['Person', 'remove']);
  const inactive = { ...people, layers: people.layers.map((layer) => layer.name === 'Person' ? { ...layer, items: layer.items.map((clip) => ({ ...clip, enabled: false, bypass: ['background'] })) } : layer) };
  const restored = groundRiseBehind(inactive, 't', 'person', ['unused', 'unused-layer']);
  assert.equal(restored.layers.length, 3);
  assert.deepEqual([restored.layers[2].items[0].enabled, restored.layers[2].items[0].bypass], [true, null]);
  const object = groundRiseBehind(timeline, 't', 'object', ['o', 'object']);
  assert.deepEqual([object.layers[2].name, object.layers[2].items[0].cutout_pick.kind], ['Object', 'objects']);
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

test('a new background takes the cut-out clip\'s place and fills the frame, and nothing after it moves', async () => {
  const { replaceBackground, clipLength, cutoutToken } = await import('../src/timeline/model.ts');
  let timeline = insertClip(insertClip(emptyTimeline(format), video('a', { out: 4, cutout: 'remove' })), video('b', { out: 3 }));
  const landscape = { media_id: 7, media_type: 'image', width: 1920, height: 1080 };
  const swapped = replaceBackground(timeline, 'a', landscape, ['bg', 'layer']);
  const [back, after] = mainLayer(swapped).items;
  assert.equal(back.media_id, 7);
  assert.equal(clipLength(back), 4);
  assert.equal(after.start, 4);
  assert.ok(back.muted);
  close(back.transform.scale, 1920 / 1080 * (1920 / 1080), 'fills a portrait frame from a landscape photo');
  const layer = swapped.layers[1];
  assert.equal(layer.id, 'layer');
  assert.equal(layer.items[0].id, 'a');
  assert.equal(layer.items[0].start, 0);
  // From the cut-out clip, now above, a short video replaces the background and plays slower to cover it.
  const again = replaceBackground(swapped, 'a', { media_id: 8, media_type: 'video', duration: 2, width: 1080, height: 1920 }, ['bg2', 'unused']);
  const slow = mainLayer(again).items[0];
  assert.equal(slow.media_id, 8);
  close(slow.speed, 0.5, 'half speed');
  close(clipLength(slow), 4, 'still four seconds');
  assert.equal(again.layers.length, swapped.layers.length);
  assert.equal(cutoutToken(video('c', { cutout: 'blur', cutout_pick: { kind: 'people', ids: [2, 0] }, blur_amount: 'strong' })), 'blur.people-0-2.strong');
  assert.equal(cutoutToken(video('c', { cutout: 'blur' })), 'blur');
  assert.equal(cutoutToken(video('c', { cutout: 'blur', cutout_pick: { kind: 'objects', ids: null } })), 'blur.objects-all.medium');
  assert.equal(cutoutToken(video('c', { cutout: 'remove', cutout_pick: { kind: 'people', ids: [1] } })), 'people-1');
});

test('a focus pull names its copy and keeps its moment in the source, forwards or backwards', async () => {
  const { cutoutToken, focusAt, focusLocal } = await import('../src/timeline/model.ts');
  const clip = video('f', { in: 2, out: 8, cutout: 'blur', cutout_pick: { kind: 'people', ids: [0] }, blur_amount: 'strong', focus_pull: { to: [1], at: 4.5, length: 0.4 } });
  assert.equal(cutoutToken(clip), 'blur.people-0.strong.people-1@4500+400');
  assert.equal(cutoutToken({ ...clip, cutout_pick: null, blur_amount: 'medium', focus_pull: { to: null, at: 3, length: 1 } }), 'blur.all.medium.all@3000+1000');
  assert.equal(focusAt(clip, 2.5), 4.5);
  close(focusLocal(clip, 4.5), 2.5, 'back to the clip');
  const backwards = { ...clip, reverse: true };
  // Two and a half seconds into a reversed 2–8 s clip shows source 5.5 s, which is 4.5 s into the reversed copy of a 10 s video.
  assert.equal(focusAt(backwards, 2.5, 10), 4.5);
  close(focusLocal(backwards, 4.5, 10), 2.5, 'back to the reversed clip');
});
