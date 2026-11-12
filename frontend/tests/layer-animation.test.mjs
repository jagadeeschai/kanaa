import test from 'node:test';
import assert from 'node:assert/strict';
import { addText, applyLayerStyles, overrideLayerItems, overriddenCount, emptyTimeline, findText, insertClip, mainLayer, markOwn, newClip, ownOverLayer, setLayerStyle, updateText, useLayerStyle } from '../src/timeline/model.ts';

const line = (id, start) => ({ id, start, length: 3, text: id, style: 'shadow', position: 'bottom', color: '#ffffff', size: 1 });
const three = () => ['a', 'b', 'c'].reduce((t, id, i) => addText(t, line(id, i * 4), 'L'), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));

test('a layer style reaches every title that does not set its own', () => {
  let t = markOwn(updateText(three(), 'b', { size: 2 }), 'b', { size: 2 });
  t = setLayerStyle(t, 'a', { size: 1.4, color: '#ffcc00', enter: { preset: 'fade', duration: 0.5 } });
  assert.deepEqual(['a', 'b', 'c'].map((id) => findText(t, id).text.size), [1.4, 2, 1.4]);
  assert.equal(findText(t, 'b').text.color, '#ffcc00');
  assert.deepEqual(ownOverLayer(t, 'b'), ['size']);
  t = useLayerStyle(t, 'b');
  assert.equal(findText(t, 'b').text.size, 1.4);
});

test('timing and words never come from the layer', () => {
  const t = setLayerStyle(three(), 'a', { start: 9, text: 'x', length: 1 });
  assert.equal(findText(t, 'b').text.start, 4);
  assert.equal(findText(t, 'b').text.text, 'b');
});

test('a new title on a styled layer takes its style', () => {
  let t = setLayerStyle(three(), 'a', { size: 1.7 });
  t = applyLayerStyles(addText(t, line('d', 12), 'L'));
  assert.equal(findText(t, 'd').text.size, 1.7);
});

test('no style, no change: the same timeline comes back', () => {
  const t = three();
  assert.equal(applyLayerStyles(t), t);
});

test('a layer style with no animation removes it from every clip but those setting their own', () => {
  const source = { media_id: 1, media_type: 'video', duration: 10, width: 1920, height: 1080 };
  let t = ['x', 'y'].reduce((acc, id) => insertClip(acc, newClip(source, id)), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));
  t = setLayerStyle(t, 'x', { enter: { preset: 'fade', duration: 1 } });
  assert.deepEqual(mainLayer(t).items.map((c) => c.enter?.preset), ['fade', 'fade']);
  t = setLayerStyle(t, 'x', { enter: null });
  assert.deepEqual(mainLayer(t).items.map((c) => c.enter), [null, null]);
});

test('override all: the layer wins over every title that set its own', () => {
  let t = markOwn(updateText(three(), 'b', { size: 2, color: '#000000' }), 'b', { size: 2, color: '#000000' });
  t = setLayerStyle(t, 'a', { size: 1.4 });
  const layer = t.layers.find((l) => l.kind === 'text').id;
  assert.equal(overriddenCount(t, layer), 1);
  const sizeOnly = overrideLayerItems(t, layer, ['size']);
  assert.equal(findText(sizeOnly, 'b').text.size, 1.4);
  assert.deepEqual(findText(sizeOnly, 'b').text.own, ['color']);
  t = overrideLayerItems(t, layer);
  assert.equal(findText(t, 'b').text.size, 1.4);
  assert.equal(overriddenCount(t, layer), 0);
});
