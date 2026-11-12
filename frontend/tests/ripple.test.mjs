import test from 'node:test';
import assert from 'node:assert/strict';
import { addText, emptyTimeline, findText, insertClip, mainLayer, moveClip, newClip, removeClip, trimClip, updateLayer } from '../src/timeline/model.ts';

const source = { media_id: 1, media_type: 'video', duration: 10, width: 1920, height: 1080 };
const line = (id, start, length = 2) => ({ id, start, length, text: id, style: 'shadow', position: 'bottom', color: '#ffffff', size: 40 });
// Clips a (0-10), b (10-20), c (20-30); titles in each, one spanning a and b, one after the end.
const start = () => {
  let t = ['a', 'b', 'c'].reduce((acc, id) => insertClip(acc, newClip(source, id)), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));
  for (const [id, at, length] of [['in-a', 2], ['in-b', 12], ['in-c', 22], ['span', 9, 3], ['late', 31]]) t = addText(t, line(id, at, length), 'L');
  return t;
};
const at = (t, id) => findText(t, id)?.text.start ?? null;

test('inserting a clip moves everything after it', () => {
  const t = insertClip(start(), newClip({ ...source, duration: 5 }, 'n'), 1);
  assert.deepEqual(['in-a', 'span', 'in-b', 'in-c', 'late'].map((id) => at(t, id)), [2, 9, 17, 27, 31]);
});

test('removing a clip takes the titles inside it and pulls the rest back', () => {
  const t = removeClip(start(), 'b');
  assert.equal(at(t, 'in-b'), null);
  assert.deepEqual(['in-a', 'span', 'in-c'].map((id) => at(t, id)), [2, 9, 12]);
});

test('trimming a clip shorter pulls later titles back', () => {
  const t = trimClip(start(), 'a', 'out', 6);
  assert.equal(at(t, 'in-b'), 8);
  assert.equal(at(t, 'in-a'), 2);
});

test('reordering: titles follow their clip', () => {
  const t = moveClip(start(), 'c', 0);
  assert.deepEqual(['in-c', 'in-a', 'in-b'].map((id) => at(t, id)), [2, 12, 22]);
});

test('an unlinked layer stays put', () => {
  let t = start();
  const layer = t.layers.find((l) => l.kind === 'text');
  t = updateLayer(t, layer.id, { ripple: false });
  t = insertClip(t, newClip({ ...source, duration: 5 }, 'n'), 0);
  assert.equal(at(t, 'in-c'), 22);
  assert.equal(mainLayer(t).items[1].start, 5);
});
