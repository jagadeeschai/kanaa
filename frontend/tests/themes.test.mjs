import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTimeline, insertClip, mainLayer, newClip, addText, textLayers } from '../src/timeline/model.ts';
import { activeTheme, applyTheme, openingWords, removeTheme, THEMES } from '../src/timeline/themes.ts';

const format = { width: 1080, height: 1920, fps: 30 };
const video = (id, extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, id), ...extra });
const photo = (id) => ({ ...newClip({ media_id: 2, media_type: 'image' }, id), out: 4 });
const byId = (name) => THEMES.find((theme) => theme.id === name);
const story = () => {
  let timeline = insertClip(insertClip(insertClip(emptyTimeline(format), video('a', { out: 5 })), photo('p')), photo('q'));
  return addText(timeline, { id: 'mine', start: 1, length: 2, text: 'என் கதை', style: 'outline', position: 'bottom', color: '#ff0000', size: 40 }, 'texts');
};
const isPhoto = (clip) => clip.media_id === 2;

test('a theme dresses every clip, joins them, moves the photos and adds opening and ending titles', () => {
  const themed = applyTheme(story(), byId('wedding'), 'Priya & Arun', isPhoto, ['layer', 'open', 'close']);
  const clips = mainLayer(themed).items;
  assert.ok(clips.every((clip) => clip.look === 'warm'));
  assert.equal(clips[0].transition_in, null);
  assert.deepEqual(clips[1].transition_in, { kind: 'crossfade', duration: 0.9 });
  assert.equal(clips[0].transform.keyframes?.scale, undefined);
  const [p, q] = [clips[1].transform.keyframes.scale, clips[2].transform.keyframes.scale];
  assert.ok(p[p.length - 1].v > p[0].v, 'first photo pushes in');
  assert.ok(q[q.length - 1].v < q[0].v, 'the next pulls out');
  assert.equal(activeTheme(themed).id, 'wedding');
  const layer = themed.layers.find((item) => item.id === 'layer');
  assert.equal(layer.items[0].text, 'Priya & Arun');
  assert.equal(layer.items[0].start, 0);
  assert.equal(layer.items[1].start + layer.items[1].length, 13);
  const mine = textLayers(themed).find((item) => item.id === 'texts').items[0];
  assert.equal(mine.text, 'என் கதை');
  assert.equal(mine.font, 'Snell Roundhand');
  assert.equal(mine.position, 'bottom');
});

test('another theme replaces the first and keeps the opening words; removing it puts the clips back', () => {
  const first = applyTheme(story(), byId('wedding'), 'Our day', isPhoto, ['l1', 'o1', 'c1']);
  const second = applyTheme(first, byId('vlog'), openingWords(first), isPhoto, ['l2', 'o2', 'c2']);
  assert.equal(second.layers.filter((layer) => layer.kind === 'text' && layer.name?.startsWith('Theme')).length, 1);
  assert.equal(activeTheme(second).id, 'vlog');
  assert.equal(openingWords(second), 'Our day');
  assert.ok(mainLayer(second).items.every((clip) => clip.look === 'cool'));
  const plain = removeTheme(second);
  assert.equal(activeTheme(plain), null);
  assert.ok(mainLayer(plain).items.every((clip) => clip.look === 'none' && !clip.transition_in));
});

test('a short video gets only the opening title', () => {
  const short = applyTheme(insertClip(emptyTimeline(format), video('a', { out: 4 })), byId('classic'), 'Short', isPhoto, ['l', 'o', 'c']);
  const layer = short.layers.find((item) => item.id === 'l');
  assert.equal(layer.items.length, 1);
  assert.ok(layer.items[0].length <= 1.6 + 1e-9);
});
