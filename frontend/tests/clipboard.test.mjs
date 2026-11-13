import test from 'node:test';
import assert from 'node:assert/strict';
import { copyItems, pasteItems, copyStyle, pasteStyle, clipboardEnd } from '../src/timeline/clipboard.ts';
import { addText, emptyTimeline, insertClip, mainLayer, newClip, textLayers, findText, findClip, addOverlay } from '../src/timeline/model.ts';

const video = { media_id: 1, media_type: 'video', duration: 4 };
let n = 0; const id = () => `n${++n}`;
const base = () => {
  let t = ['a', 'b', 'c'].reduce((t, id) => insertClip(t, newClip(video, id)), emptyTimeline({ width: 1080, height: 1920, fps: 30 }));
  t = addText(t, { id: 't1', start: 1, length: 2, text: 'வணக்கம்', style: 'outline', position: 'center', color: '#fff', size: 80, font: 'Mukta' }, 'L1');
  return addText(t, { id: 't2', start: 4, length: 1, text: 'two', style: 'shadow', position: 'bottom', color: '#f00', size: 40 }, 'L1');
};

test('pasted titles keep their spacing and land at the playhead', () => {
  const t = base();
  const { timeline, ids } = pasteItems(t, copyItems(t, ['t1', 't2']), 6, id);
  assert.deepEqual(ids.map((x) => findText(timeline, x).text.start), [6, 9]);
  assert.equal(findText(timeline, ids[0]).text.text, 'வணக்கம்');
  assert.equal(textLayers(timeline).length, 1, 'back on their own layer when it is free');
});

test('a paste over a busy spot goes on a new layer instead of covering anything', () => {
  const t = base();
  const { timeline } = pasteItems(t, copyItems(t, ['t1']), 1.5, id);
  assert.equal(textLayers(timeline).length, 2);
  assert.equal(findText(timeline, 't1').text.start, 1);
});

test('main clips go in as a block at the nearest edge and push the rest along', () => {
  const t = base();
  const { timeline, ids } = pasteItems(t, copyItems(t, ['a']), 4.5, id);
  assert.deepEqual(mainLayer(timeline).items.map((c) => c.id), ['a', ids[0], 'b', 'c']);
  assert.equal(findText(timeline, 't2').text.start, 8, 'later titles ripple');
  assert.equal(clipboardEnd(t, ['a', 't1']), 4);
});

test('the style painter copies the look, never the words or timing', () => {
  const t = base();
  const next = pasteStyle(t, copyStyle(t, 't1'), ['t2']);
  const two = findText(next, 't2').text;
  assert.equal(two.text, 'two'); assert.equal(two.start, 4); assert.equal(two.length, 1);
  assert.equal(two.size, 80); assert.equal(two.font, 'Mukta'); assert.equal(two.position, 'center');
});

test('across a title and a clip only movement carries over', () => {
  let t = base();
  t = addOverlay(t, { ...newClip(video, 'o'), start: 0, enter: null, adjust: { ...newClip(video, 'x').adjust, brightness: 0.3 } }, 'V');
  const withMove = pasteStyle(t, { kind: 'title', values: { enter: { preset: 'fade', duration: 0.5 }, size: 99 } }, ['o']);
  const o = findClip(withMove, 'o');
  assert.deepEqual(o.enter, { preset: 'fade', duration: 0.5 });
  assert.equal(o.size, undefined);
});
