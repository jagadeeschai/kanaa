import test from 'node:test';
import assert from 'node:assert/strict';
import { addText, animateWholeLayer, moveWholeLayer, emptyTimeline, findText, insertClip, layerCount, mainLayer, newClip, updateClip, updateText } from '../src/timeline/model.ts';

const line = (id, start, length) => ({ id, start, length, text: id, style: 'shadow', position: 'bottom', color: '#ffffff', size: 1 });

test('every title in the layer gets the same enter and exit, fitted to short lines', () => {
  let t = emptyTimeline({ width: 1920, height: 1080, fps: 30 });
  t = addText(t, line('a', 0, 4), 'L'); t = addText(t, line('b', 5, 4), 'L'); t = addText(t, line('c', 10, 1), 'L');
  t = updateText(t, 'a', { enter: { preset: 'fade', duration: 0.8 }, exit: { preset: 'slide-up', duration: 0.6 } });
  assert.equal(layerCount(t, 'a'), 3);
  t = animateWholeLayer(t, 'a');
  assert.deepEqual(findText(t, 'b').text.enter, { preset: 'fade', duration: 0.8 });
  assert.deepEqual(findText(t, 'b').text.exit, { preset: 'slide-up', duration: 0.6 });
  assert.deepEqual(findText(t, 'c').text.enter, { preset: 'fade', duration: 0.5 });
});

test('a scene-depth reveal on another title is kept', () => {
  let t = emptyTimeline({ width: 1920, height: 1080, fps: 30 });
  t = addText(t, line('a', 0, 4), 'L'); t = addText(t, line('b', 5, 4), 'L');
  t = updateText(t, 'b', { enter: { preset: 'rise-behind', duration: 1.2 } });
  t = updateText(t, 'a', { enter: { preset: 'fade', duration: 0.5 } });
  t = animateWholeLayer(t, 'a');
  assert.equal(findText(t, 'b').text.enter.preset, 'rise-behind');
});

test('clips in a layer share the enter and exit', () => {
  const source = { media_id: 1, media_type: 'video', duration: 10, width: 1920, height: 1080 };
  let t = ['x', 'y'].reduce((acc, id) => insertClip(acc, newClip(source, id)), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));
  t = updateClip(t, 'x', { enter: { preset: 'fade', duration: 1 } });
  t = animateWholeLayer(t, 'x');
  assert.deepEqual(mainLayer(t).items.map((c) => c.enter?.preset), ['fade', 'fade']);
});

test('no animation on the chosen title removes them from every title, cinematic ones too', () => {
  let t = emptyTimeline({ width: 1920, height: 1080, fps: 30 });
  t = addText(t, line('a', 0, 4), 'L'); t = addText(t, line('b', 5, 4), 'L'); t = addText(t, line('c', 10, 4), 'L');
  t = updateText(t, 'b', { enter: { preset: 'fade', duration: 0.5 }, exit: { preset: 'fade', duration: 0.5 } });
  t = updateText(t, 'c', { enter: { preset: 'rise-behind', duration: 1.2 } });
  t = animateWholeLayer(t, 'a');
  for (const id of ['b', 'c']) { assert.equal(findText(t, id).text.enter, null); assert.equal(findText(t, id).text.exit, null); }
});

test('no animation on the chosen clip removes them from every clip', () => {
  const source = { media_id: 1, media_type: 'video', duration: 10, width: 1920, height: 1080 };
  let t = ['x', 'y'].reduce((acc, id) => insertClip(acc, newClip(source, id)), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));
  t = updateClip(t, 'y', { enter: { preset: 'fade', duration: 1 }, exit: { preset: 'fade', duration: 1 } });
  t = animateWholeLayer(t, 'x');
  assert.deepEqual(mainLayer(t).items.map((c) => [c.enter, c.exit]), [[null, null], [null, null]]);
});

test('no keyframed motion on the chosen title removes it from every title; a motion is copied to all', () => {
  let t = emptyTimeline({ width: 1920, height: 1080, fps: 30 });
  const slide = { x: 0.5, y: 0.8, scale: 1, opacity: 1, rotation: 0, keyframes: { x: [{ t: 0, v: 0.1, ease: 'easeInOut' }, { t: 1.6, v: 0.5, ease: 'easeInOut' }] } };
  t = addText(t, line('a', 0, 4), 'L'); t = addText(t, { ...line('b', 5, 4), transform: slide }, 'L');
  t = moveWholeLayer(t, 'a');
  assert.deepEqual(findText(t, 'b').text.transform.keyframes, {});
  assert.equal(findText(t, 'b').text.transform.x, 0.5);
  t = updateText(t, 'b', { transform: slide });
  t = moveWholeLayer(t, 'b');
  assert.deepEqual(findText(t, 'a').text.transform.keyframes, slide.keyframes);
});
