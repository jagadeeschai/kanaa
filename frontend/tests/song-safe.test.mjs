import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteAndStretch, replaceClips } from '../src/timeline/songSafe.ts';
import { clipLength, duration, insertClip, newClip, normalizeTimeline, removeClip, trackLayers } from '../src/timeline/model.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = (id, start, length, extra = {}) => ({ id, media_id: 1, start, in: 0, out: length, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: { ...REST }, adjust: {}, ...extra });
const song = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [
  { id: 'main', kind: 'video', items: [clip('a', 0, 4), clip('b', 4, 3, { transition_in: { kind: 'crossfade', duration: 0.5 } }), clip('c', 7, 5), clip('d', 12, 4)] },
  { id: 'lyric-titles', kind: 'text', items: [{ id: 'l1', start: 5, length: 2, text: 'one' }, { id: 'l2', start: 13, length: 2, text: 'two' }] },
  { id: 'lyric-light', kind: 'video', items: [] },
  { id: 'song', kind: 'audio', items: [{ id: 's', asset_id: 'x', start: 1, in: 0, out: 20, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0 }] }] });
const IMAGE = (id) => ({ media_id: id, media_type: 'image' });
const VIDEO = (id, d) => ({ media_id: id, media_type: 'video', duration: d });
const mainOf = (t) => t.layers[0].items;

test('a picture replaces neighbouring clips in exactly their time; nothing else moves', () => {
  const t = song();
  const { timeline } = replaceClips(t, ['b', 'c'], IMAGE(9), 'n');
  assert.deepEqual(mainOf(timeline).map((c) => [c.id, c.start, clipLength(c)]), [['a', 0, 4], ['n', 4, 8], ['d', 12, 4]]);
  assert.deepEqual(mainOf(timeline)[1].transition_in, { kind: 'crossfade', duration: 0.5 });
  assert.equal(duration(timeline), duration(t));
  assert.deepEqual(timeline.layers.slice(1), t.layers.slice(1));
});

test('a video is trimmed when longer, slowed when shorter, refused when far too short', () => {
  const long = replaceClips(song(), ['c'], VIDEO(9, 12), 'n').timeline;
  assert.deepEqual([mainOf(long)[2].out, mainOf(long)[2].speed], [5, 1]);
  const short = replaceClips(song(), ['c'], VIDEO(9, 2.5), 'n').timeline;
  assert.equal(clipLength(mainOf(short)[2]), 5);
  assert.equal(mainOf(short)[2].speed, 0.5);
  assert.ok('problem' in replaceClips(song(), ['c'], VIDEO(9, 1), 'n'));
  assert.ok('problem' in replaceClips(song(), ['a', 'c'], IMAGE(9), 'n'));  // Not next to each other.
});

test('delete and stretch: the clip before fills the gap, the length stays', () => {
  const t = song();
  const after = deleteAndStretch(t, 'c', (id) => IMAGE(id));
  assert.deepEqual(mainOf(after).map((c) => [c.id, c.start, clipLength(c)]), [['a', 0, 4], ['b', 4, 8], ['d', 12, 4]]);
  assert.equal(duration(after), duration(t));
});

test('delete and stretch: a video without room before uses the clip after; neither: null', () => {
  const t = song();
  const noRoom = (id) => VIDEO(id, 4);  // Every clip's source ends where it does.
  const t2 = { ...t, layers: [{ ...t.layers[0], items: mainOf(t).map((c) => ({ ...c, in: 3, out: 3 + clipLength(c) })) }, ...t.layers.slice(1)] };
  const after = deleteAndStretch(t2, 'b', (id) => VIDEO(id, 20));
  assert.equal(clipLength(mainOf(after)[0]), 7);
  const viaNext = deleteAndStretch(t2, 'b', (id) => ({ media_id: id, media_type: 'video', duration: 7 }));  // 'a' plays 3-7 of 7: no room after.
  assert.deepEqual(mainOf(viaNext).map((c) => [c.id, c.start, clipLength(c), c.in]), [['a', 0, 4, 3], ['c', 4, 8, 0], ['d', 12, 4, 3]]);
  assert.equal(deleteAndStretch(t, 'b', noRoom), null);
});

test('song and lyric layers stay put by default when pictures are added or removed', () => {
  const t = normalizeTimeline(song());
  assert.deepEqual(t.layers.filter((l) => l.id === 'song' || l.id === 'lyric-titles').map((l) => l.ripple), [false, false]);
  const removed = removeClip(t, 'b');
  assert.deepEqual(removed.layers.find((l) => l.id === 'lyric-titles').items.map((i) => i.start), [5, 13]);
  assert.equal(removed.layers.find((l) => l.id === 'song').items[0].start, 1);
  const inserted = insertClip(t, newClip(IMAGE(5), 'z'), 1);
  assert.deepEqual(inserted.layers.find((l) => l.id === 'lyric-titles').items.map((i) => i.start), [5, 13]);
  // A layer someone set to follow the pictures keeps that.
  assert.equal(normalizeTimeline({ ...song(), layers: song().layers.map((l) => (l.id === 'song' ? { ...l, ripple: true } : l)) }).layers[3].ripple, true);
});

test('in a song video the song row sits right under the titles', () => {
  assert.deepEqual(trackLayers(song()).map((l) => l.id), ['lyric-titles', 'song', 'lyric-light']);
});
