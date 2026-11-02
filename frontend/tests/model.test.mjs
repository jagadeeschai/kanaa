import test from 'node:test';
import assert from 'node:assert/strict';
import { clipAt, duration, emptyTimeline, exportFormat, fillScale, fittedSize, insertClip, mainLayer, moveClip, newClip, normalizeTimeline, removeClip, snap, splitClip, timecode, trimClip } from '../src/timeline/model.ts';
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
