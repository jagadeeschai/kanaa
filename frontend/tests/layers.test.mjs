import test from 'node:test';
import assert from 'node:assert/strict';
import { addSound, audioLayers, emptyTimeline, updateLayer } from '../src/timeline/model.ts';

const format = { width: 1920, height: 1080, fps: 30 };
const song = (id, start = 0) => ({ id, start, in: 0, out: 10, speed: 1, volume: 0.6, muted: false, fade_in: 0, fade_out: 0, duck: true, name: 'Song', source_length: 10 });

test('new audio layers are named Music 1, Music 2, …', () => {
  let timeline = emptyTimeline(format);
  timeline = addSound(timeline, song('a', 0), 'l1');
  timeline = addSound(timeline, song('b', 5), 'l2'); // overlaps the first, so it needs its own track
  const layers = audioLayers(timeline);
  assert.equal(layers.length, 2);
  assert.equal(layers[0].name, 'Music 1');
  assert.equal(layers[1].name, 'Music 2');
});

test('a layer can be renamed and cleared back', () => {
  let timeline = emptyTimeline(format);
  timeline = addSound(timeline, song('a'), 'l1');
  const id = audioLayers(timeline)[0].id;
  const named = updateLayer(timeline, id, { name: 'My BGM' });
  assert.equal(audioLayers(named)[0].name, 'My BGM');
  const cleared = updateLayer(named, id, { name: '' });
  assert.equal(audioLayers(cleared)[0].name, '');
});
