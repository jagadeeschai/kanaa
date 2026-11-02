import test from 'node:test';
import assert from 'node:assert/strict';
import { addKey, hasKeyAt, isAnimated, keyTimes, moveKey, removeKey, setEase, shiftKeys, splitKeys, toggleAnimated, writeValue } from '../src/timeline/keyframes.ts';
import { valueAt } from '../src/timeline/evaluate.ts';
import { addOverlay, findClip, updateClip, addText, findText, moveItem, removeText, transitionHalf, trimText, addSound, audioLayers, detachAudio, fadeGain, findSound, moveSound, removeSound, splitSound, trimSound, clipAt, duration, emptyTimeline, exportFormat, fillScale, fittedSize, insertClip, mainLayer, moveClip, newClip, normalizeTimeline, removeClip, snap, splitClip, timecode, trimClip } from '../src/timeline/model.ts';
import { commit, redo, startHistory, undo } from '../src/timeline/history.ts';

const source = { media_id: 1, media_type: 'video', duration: 10, width: 1920, height: 1080 };
const start = () => [['a', 10], ['b', 10]].reduce((t, [id]) => insertClip(t, newClip(source, id)), emptyTimeline({ width: 1080, height: 1920, fps: 30 }));
const clips = (t) => mainLayer(t).items.map((c) => [c.id, c.start, c.in, c.out]);

test('clips pack end to end', () => { assert.deepEqual(clips(start()), [['a', 0, 0, 10], ['b', 10, 0, 10]]); assert.equal(duration(start()), 20); });
test('split keeps the picture continuous', () => {
  assert.deepEqual(clips(splitClip(start(), 4, 'c')), [['a', 0, 0, 4], ['c', 4, 4, 10], ['b', 10, 0, 10]]);
});
test('split respects speed', () => {
  let t = insertClip(emptyTimeline({ width: 100, height: 100, fps: 30 }), { ...newClip(source, 'a'), speed: 2 });
  t = splitClip(t, 2, 'b');
  assert.deepEqual(clips(t), [['a', 0, 0, 4], ['b', 2, 4, 10]]);
});
test('split at a clip edge does nothing', () => { const t = start(); assert.equal(splitClip(t, 10, 'c'), t); });
test('removing ripples later clips left', () => assert.deepEqual(clips(removeClip(start(), 'a')), [['b', 0, 0, 10]]));
test('moving reorders and repacks', () => assert.deepEqual(clips(moveClip(start(), 'b', 0)), [['b', 0, 0, 10], ['a', 10, 0, 10]]));
test('trim stays inside the source and keeps a minimum', () => {
  assert.equal(mainLayer(trimClip(start(), 'a', 'out', 99, source)).items[0].out, 10);
  assert.equal(mainLayer(trimClip(start(), 'a', 'in', 99, source)).items[0].in, 9.9);
  assert.equal(mainLayer(trimClip(start(), 'a', 'in', -5, source)).items[0].in, 0);
  assert.equal(mainLayer(trimClip(start(), 'a', 'out', 4, source)).items[1].start, 4);
});
test('photos can be held longer than their default', () => {
  const photo = { media_id: 2, media_type: 'image' };
  const t = insertClip(emptyTimeline({ width: 100, height: 100, fps: 30 }), newClip(photo, 'p'));
  assert.equal(mainLayer(trimClip(t, 'p', 'out', 30, photo)).items[0].out, 30);
});
test('clip at the very end is the last clip', () => assert.equal(clipAt(start(), 20).id, 'b'));
test('snap picks the nearest point within reach', () => { assert.equal(snap(9.9, [0, 10, 20], 0.2), 10); assert.equal(snap(9, [0, 10], 0.2), 9); });
test('a landscape clip fills a portrait frame', () => {
  const format = { width: 1080, height: 1920, fps: 30 };
  assert.deepEqual(fittedSize(source, 0, format), { width: 1080, height: 607.5 });
  assert.ok(Math.abs(fillScale(source, 0, format) - 1920 / 607.5) < 1e-9);
  assert.equal(fillScale(source, 90, format), 1);
});
test('export sizes stay even and keep the shape', () => {
  assert.deepEqual(exportFormat({ width: 1080, height: 1350, fps: 30 }, 2160), { width: 2160, height: 2700, fps: 30 });
  assert.deepEqual(exportFormat({ width: 1920, height: 1080, fps: 30 }, 720), { width: 1280, height: 720, fps: 30 });
});
test('timecode never shows sixty seconds', () => { assert.equal(timecode(59.999), '1:00.00'); assert.equal(timecode(1.5), '0:01.15'); });
test('undo and redo walk the edits', () => {
  let h = commit(commit(startHistory(0), 1), 2);
  h = undo(h); assert.equal(h.present, 1);
  h = undo(h); assert.equal(h.present, 0);
  assert.equal(undo(h).present, 0);
  h = redo(h); assert.equal(h.present, 1);
  assert.equal(commit(h, 9).future.length, 0);
});
test('one drag undoes as one step', () => {
  let h = startHistory(0);
  for (const v of [1, 2, 3]) h = commit(h, v, 'drag');
  assert.equal(undo(h).present, 0);
  h = commit(h, 4, 'other');
  assert.equal(undo(h).present, 3);
});

test('normalizeTimeline fills fields the server omits and repairs magnetic starts', () => {
  const sparse = { version: 2, format: { width: 1080, height: 1920, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [
    { id: 'a', media_id: 1, start: 0, in: 0, out: 8, adjust: {} }, { id: 'b', media_id: 2, start: null, in: 0, out: 6, speed: 2 }] }] };
  const [first, second] = normalizeTimeline(sparse).layers[0].items;
  assert.equal(first.speed, 1);
  assert.equal(first.transform.scale, 1);
  assert.equal(first.adjust.brightness, 1);
  assert.equal(second.start, 8);
});

const facts = { media_id: 1, media_type: 'video', duration: 10, width: 1920, height: 1080 };
const song = (id, start, length = 3, extra = {}) => ({ id, asset_id: 'a'.repeat(32), start, in: 0, out: length, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, duck: false, name: id, source_length: 20, ...extra });
const withClip = () => insertClip(emptyTimeline({ width: 1080, height: 1920, fps: 30 }), newClip(facts, 'c'));

test('detachAudio mutes the picture and leaves the sound in the same place', () => {
  const next = detachAudio(withClip(), 'c', 's', 'l', 'Sound', 10);
  assert.equal(mainLayer(next).items[0].muted, true);
  const { sound } = findSound(next, 's');
  assert.deepEqual([sound.media_id, sound.start, sound.in, sound.out], [1, 0, 0, 10]);
  assert.equal(detachAudio(next, 'c', 't', 'm', 'Again'), next);
});

test('undoing a detach through history restores the clip sound', () => {
  let history = startHistory(withClip());
  history = commit(history, detachAudio(history.present, 'c', 's', 'l', 'Sound', 10), null);
  history = undo(history);
  assert.equal(mainLayer(history.present).items[0].muted, false);
  assert.equal(audioLayers(history.present).length, 0);
});

test('sounds that overlap go on a new track, and an empty track is removed', () => {
  let next = addSound(addSound(withClip(), song('a', 0), 'l1'), song('b', 1), 'l2');
  assert.equal(audioLayers(next).length, 2);
  next = addSound(next, song('c', 4), 'l3');
  assert.equal(audioLayers(next).length, 2);
  assert.equal(audioLayers(removeSound(next, 'b')).length, 1);
});

test('a moved sound stops at its neighbour and can change track', () => {
  let next = addSound(addSound(withClip(), song('a', 0), 'l1'), song('b', 5), 'l1');
  assert.equal(findSound(moveSound(next, 'a', 4), 'a').sound.start, 2);
  assert.equal(findSound(moveSound(next, 'a', -3), 'a').sound.start, 0);
  next = addSound(next, song('c', 1), 'l2');
  const moved = moveSound(next, 'c', 9, 'l1');
  assert.equal(findSound(moved, 'c').layer.id, 'l1');
});

test('moving a sound does not move its clip', () => {
  const next = detachAudio(withClip(), 'c', 's', 'l', 'Sound', 10);
  const moved = moveSound(next, 's', 2);
  assert.equal(mainLayer(moved).items[0].start, 0);
  assert.equal(findSound(moved, 's').sound.start, 2);
  assert.equal(duration(moved), 12);
});

test('trimming a sound respects its source and neighbours', () => {
  const next = addSound(addSound(withClip(), song('a', 2), 'l1'), song('b', 6), 'l1');
  const late = findSound(trimSound(next, 'a', 'in', 1), 'a').sound;
  assert.deepEqual([late.start, late.in], [3, 1]);
  assert.equal(findSound(trimSound(next, 'a', 'out', 15), 'a').sound.out, 4);
  assert.equal(findSound(trimSound(next, 'b', 'out', 50), 'b').sound.out, 20);
});

test('splitting a sound keeps each outer fade', () => {
  const next = addSound(withClip(), song('a', 1, 4, { fade_in: 1, fade_out: 1 }), 'l1');
  const split = splitSound(next, 'a', 3, 'b');
  const [first, second] = [findSound(split, 'a').sound, findSound(split, 'b').sound];
  assert.deepEqual([first.out, first.fade_in, first.fade_out], [2, 1, 0]);
  assert.deepEqual([second.start, second.in, second.fade_in, second.fade_out], [3, 2, 0, 1]);
});

test('fadeGain rises, holds and falls, and shares overlong fades', () => {
  const item = { fade_in: 1, fade_out: 2 };
  assert.equal(fadeGain(item, 0.5, 10), 0.5);
  assert.equal(fadeGain(item, 5, 10), 1);
  assert.equal(fadeGain(item, 9, 10), 0.5);
  assert.equal(fadeGain({ fade_in: 4, fade_out: 4 }, 1, 2), 1);
});

const title = (id, start, length = 3) => ({ id, start, length, text: 'தமிழ்', style: 'band', position: 'bottom', color: '#ffffff', size: 44 });

test('titles stack on a new track only when they overlap, and leave when empty', () => {
  let next = addText(addText(withClip(), title('a', 0), 'l1'), title('b', 1), 'l2');
  assert.equal(next.layers.filter((layer) => layer.kind === 'text').length, 2);
  next = addText(next, title('c', 5), 'l3');
  assert.equal(next.layers.filter((layer) => layer.kind === 'text').length, 2);
  assert.equal(removeText(removeText(next, 'a'), 'c').layers.filter((layer) => layer.kind === 'text').length, 1);
});

test('text moves in time and trims against its neighbours, and stays off sound tracks', () => {
  let next = addText(addText(withClip(), title('a', 0), 'l1'), title('b', 4), 'l1');
  next = addSound(next, song('s', 0), 'l2');
  assert.equal(findText(moveItem(next, 'a', 3), 'a').text.start, 1);
  assert.equal(findText(moveItem(next, 'a', 0, 'l2'), 'a').layer.id, 'l1');
  assert.equal(findText(trimText(next, 'a', 'out', 9), 'a').text.length, 4);
  const late = findText(trimText(next, 'b', 'in', 5), 'b').text;
  assert.deepEqual([late.start, late.length], [5, 2]);
});

test('transitionHalf needs touching clips and fits inside both', () => {
  const a = { ...newClip(facts, 'a'), start: 0, out: 2 };
  const b = { ...newClip(facts, 'b'), start: 2, out: 2, transition_in: { kind: 'wipe', duration: 1 } };
  assert.equal(transitionHalf(a, b, 30), 15);
  assert.equal(transitionHalf(a, { ...b, start: 3 }, 30), 0);
  assert.equal(transitionHalf(a, { ...b, transition_in: { kind: 'wipe', duration: 2 }, out: 0.5 }, 30), 7);
  assert.equal(transitionHalf(a, { ...b, transition_in: null }, 30), 0);
});

const still = () => ({ x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 });
const moving = () => {
  let t = toggleAnimated(still(), 'position', 0);
  t = writeValue(writeValue(t, 'x', 2, 0.9), 'y', 2, 0.1);
  return t;
};

test('the stopwatch keeps the value on, and keeps the value at the playhead off', () => {
  const on = toggleAnimated({ ...still(), scale: 2 }, 'scale', 1);
  assert.deepEqual(on.keyframes.scale.map((key) => [key.t, key.v]), [[1, 2]]);
  const twoKeys = writeValue(on, 'scale', 3, 4);
  const off = toggleAnimated(twoKeys, 'scale', 2);
  assert.equal(isAnimated(off, 'scale'), false);
  assert.equal(off.scale, valueAt(twoKeys, 'scale', 2));
});

test('editing writes a key only when animated, and position keys both axes', () => {
  assert.equal(writeValue(still(), 'x', 2, 0.1).x, 0.1);
  const path = moving();
  assert.deepEqual(keyTimes(path, 'position'), [0, 2]);
  assert.deepEqual(path.keyframes.y.map((key) => key.v), [0.5, 0.1]);
});

test('a second edit near a key changes it instead of adding one', () => {
  const again = writeValue(moving(), 'x', 2.01, 0.2);
  assert.equal(again.keyframes.x.length, 2);
  assert.equal(again.keyframes.x[1].v, 0.2);
});

test('removing the last key leaves the value it had', () => {
  const removed = removeKey(removeKey(moving(), 'position', 0), 'position', 2);
  assert.equal(isAnimated(removed, 'position'), false);
  assert.equal(removed.x, 0.9);
});

test('adding a key mid curve does not change the motion much, and ease applies to the control', () => {
  const added = addKey(setEase(moving(), 'position', 'linear'), 'position', 1);
  assert.ok(hasKeyAt(added, 'position', 1));
  assert.ok(Math.abs(valueAt(added, 'x', 1.5) - 0.8) < 1e-9);
  assert.deepEqual([...new Set(setEase(moving(), 'position', 'easeOut').keyframes.y.map((key) => key.ease))], ['easeOut']);
});

test('moveKey changes both axes of one key', () => {
  const moved = moveKey(moving(), 2, 0.3, 0.7);
  assert.deepEqual([valueAt(moved, 'x', 2), valueAt(moved, 'y', 2)], [0.3, 0.7]);
});

test('splitKeys keeps the motion on both sides of the cut', () => {
  const path = setEase(moving(), 'position', 'linear');
  const [first, second] = splitKeys(path, 1);
  assert.ok(Math.abs(valueAt(first, 'x', 0.5) - valueAt(path, 'x', 0.5)) < 1e-9);
  assert.ok(Math.abs(valueAt(second, 'x', 0.5) - valueAt(path, 'x', 1.5)) < 1e-9);
});

test('shiftKeys never leaves a key before the start', () => {
  const later = shiftKeys(setEase(moving(), 'position', 'linear'), -1);
  assert.equal(later.keyframes.x[0].t, 0);
  assert.ok(Math.abs(later.keyframes.x[0].v - 0.7) < 1e-9);
});

test('split and trim keep a clip animated on the same footage', () => {
  const clip = { ...newClip(facts, 'c'), transform: setEase(moving(), 'position', 'linear') };
  const base = insertClip(emptyTimeline({ width: 1080, height: 1920, fps: 30 }), clip);
  const cut = splitClip(base, 1, 'd');
  assert.ok(Math.abs(valueAt(findClip(cut, 'd').transform, 'x', 0) - 0.7) < 1e-9);
  const trimmed = trimClip(base, 'c', 'in', 1, facts);
  assert.ok(Math.abs(valueAt(findClip(trimmed, 'c').transform, 'x', 0) - 0.7) < 1e-9);
});

test('a split clip enters once and exits once', () => {
  const clip = { ...newClip(facts, 'c'), enter: { preset: 'fade', duration: 1 }, exit: { preset: 'zoom', duration: 1 } };
  const cut = splitClip(insertClip(emptyTimeline({ width: 1080, height: 1920, fps: 30 }), clip), 5, 'd');
  assert.deepEqual([findClip(cut, 'c').exit, findClip(cut, 'd').enter], [null, null]);
  assert.equal(findClip(cut, 'c').enter.preset, 'fade');
  assert.equal(findClip(cut, 'd').exit.preset, 'zoom');
});

test('overlays sit above the main track, below text, and never pull the main track', () => {
  const logo = (id, start) => ({ ...newClip(facts, id), start, out: 2 });
  let next = addText(withClip(), title('t', 0), 'words');
  next = addOverlay(next, logo('o', 3), 'over');
  assert.deepEqual(next.layers.map((layer) => layer.id), [mainLayer(next).id, 'over', 'words']);
  assert.equal(findClip(next, 'o').start, 3);
  assert.equal(mainLayer(next).items[0].start, 0);
  assert.equal(addOverlay(next, logo('p', 6), 'x').layers.length, 3);
  assert.equal(addOverlay(next, logo('q', 4), 'x').layers.length, 4);
  const moved = moveItem(next, 'o', 7);
  assert.equal(findClip(moved, 'o').start, 7);
  assert.equal(removeClip(next, 'o').layers.length, 2);
  assert.equal(updateClip(next, 'o', { volume: 0.5 }).layers[1].items[0].volume, 0.5);
});
