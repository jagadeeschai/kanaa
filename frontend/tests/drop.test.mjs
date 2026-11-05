import test from 'node:test';
import assert from 'node:assert/strict';
import { applyClipDrop, decodePayload, dropClip, dropHint, encodePayload, insertIndex } from '../src/timeline/drop.ts';
import { emptyTimeline, insertClip, mainLayer, newClip, updateLayer } from '../src/timeline/model.ts';
import { isSongFile, startImageAt } from '../src/utils/slides.ts';

const source = { media_id: 1, media_type: 'video', duration: 4 };
const three = () => ['a', 'b', 'c'].reduce((t, id) => insertClip(t, newClip(source, id)), emptyTimeline({ width: 1080, height: 1920, fps: 30 }));
const order = (t) => [...mainLayer(t).items].sort((x, y) => x.start - y.start).map((clip) => clip.id);

test('payloads round-trip and anything else is ignored', () => {
  for (const payload of [{ kind: 'media', id: 7 }, { kind: 'look', look: 'warm' }, { kind: 'transition', transition: 'wipe' }, { kind: 'title', template: 'clean' }, { kind: 'track', track: 'x1' }]) assert.deepEqual(decodePayload(encodePayload(payload)), payload);
  assert.equal(decodePayload('not json'), null);
  assert.equal(decodePayload('{"kind":"media","id":"7"}'), null);
  assert.equal(decodePayload(null), null);
});

test('media dropped on the main track goes where it was dropped', () => {
  const t = three(); // a 0-4, b 4-8, c 8-12
  assert.equal(insertIndex(t, 0), 0);
  assert.equal(insertIndex(t, 5), 1); // before b's middle
  assert.equal(insertIndex(t, 7), 2);
  assert.equal(insertIndex(t, 99), 3);
  assert.deepEqual(order(dropClip(t, newClip(source, 'n'), 7)), ['a', 'b', 'n', 'c']);
});

test('drop hints say what will happen, and refuse what cannot', () => {
  const t = three();
  assert.equal(dropHint(t, { kind: 'media', id: 1 }, { zone: 'main', time: 1, clipId: 'a' }), 'Insert here');
  assert.equal(dropHint(t, { kind: 'media', id: 1 }, { zone: 'above', time: 1, clipId: 'a' }), 'Add on top');
  assert.equal(dropHint(updateLayer(t, 'main', { locked: true }), { kind: 'media', id: 1 }, { zone: 'main', time: 1, clipId: 'a' }), null);
  assert.equal(dropHint(t, { kind: 'look', look: 'warm' }, { zone: 'main', time: 50, clipId: null }), null);
  assert.equal(dropHint(t, { kind: 'transition', transition: 'wipe' }, { zone: 'main', time: 1, clipId: 'a' }), null, 'the first clip has nothing to blend from');
  assert.ok(dropHint(t, { kind: 'transition', transition: 'wipe' }, { zone: 'main', time: 5, clipId: 'b' }));
});

test('looks and transitions dropped on a clip change only that clip', () => {
  const t = three();
  const looked = applyClipDrop(t, { kind: 'look', look: 'mono' }, 'b');
  assert.deepEqual(mainLayer(looked).items.map((clip) => clip.look ?? 'none'), ['none', 'mono', 'none']);
  const blended = applyClipDrop(t, { kind: 'transition', transition: 'whip' }, 'c');
  assert.deepEqual(mainLayer(blended).items.find((clip) => clip.id === 'c').transition_in, { kind: 'whip', duration: 0.6 });
  assert.equal(applyClipDrop(t, { kind: 'transition', transition: 'whip' }, 'a'), t);
});

test('a lyric line dropped on an image starts it there, keeping order', () => {
  const starts = [0, 10, 20];
  assert.deepEqual(startImageAt(starts, 1, 6.5, 30), [0, 6.5, 20]);
  assert.equal(startImageAt(starts, 0, 3, 30), null, 'the first image starts at 0');
  assert.equal(startImageAt(starts, 1, 0.5, 30), null, 'too close to the image before');
  assert.equal(startImageAt(starts, 1, 19.5, 30), null, 'too close to the image after');
  assert.equal(startImageAt(starts, 2, 29.5, 30), null, 'too close to the end');
  assert.ok(isSongFile({ type: 'audio/mpeg', name: 'a.mp3' }));
  assert.ok(isSongFile({ type: '', name: 'Song.FLAC' }));
  assert.ok(!isSongFile({ type: 'image/png', name: 'a.png' }));
});
