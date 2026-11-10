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

test('a main clip dragged onto a video layer leaves the main track and lands there', async () => {
  const { clipToLayer, clipToMain, emptyTimeline, insertClip, newClip, mainLayer, overlayLayers, addLayer, clipLength } = await import('../src/timeline/model.ts');
  const make = (id) => newClip({ media_id: 1, media_type: 'video', duration: 10 }, id);
  let timeline = ['a', 'b', 'c'].reduce((t, id) => insertClip(t, make(id)), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));
  timeline = addLayer(timeline, 'video', 'over');
  const b = mainLayer(timeline).items[1];
  const moved = clipToLayer({ ...timeline, layers: timeline.layers.map((l) => l.id === 'b' ? l : l) }, b.id, 'over', 3);
  assert.deepEqual(mainLayer(moved).items.map((clip) => clip.id), ['a', 'c'], 'the main track closes up');
  assert.equal(mainLayer(moved).items[1].start, clipLength(mainLayer(moved).items[0]), 'with no gap');
  const landed = overlayLayers(moved).find((layer) => layer.id === 'over').items;
  assert.deepEqual(landed.map((clip) => [clip.id, clip.start, clip.transition_in ?? null]), [['b', 3, null]]);
  const back = clipToMain(moved, 'b', 0);
  assert.deepEqual(mainLayer(back).items.map((clip) => clip.id), ['b', 'a', 'c'], 'and back onto the main track where dropped');
  assert.equal(overlayLayers(back).find((layer) => layer.id === 'over')?.items.length, 0, 'its layer stays, empty');
  const only = ['a'].reduce((t, id) => insertClip(t, make(id)), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));
  const lone = addLayer(only, 'video', 'over');
  assert.equal(clipToLayer(lone, 'a', 'over', 0), lone, 'the last main clip stays');
});

test('dropped over a clip on the layer, it takes the nearest free place', async () => {
  const { clipToLayer, emptyTimeline, insertClip, newClip, overlayLayers, addLayer } = await import('../src/timeline/model.ts');
  const make = (id) => newClip({ media_id: 1, media_type: 'video', duration: 2 }, id);
  let timeline = ['a', 'b'].reduce((t, id) => insertClip(t, make(id)), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));
  timeline = addLayer(timeline, 'video', 'over');
  timeline = { ...timeline, layers: timeline.layers.map((layer) => layer.id === 'over' ? { ...layer, items: [{ ...make('o'), start: 1 }] } : layer) };
  const moved = clipToLayer(timeline, 'b', 'over', 1.4);
  const landed = overlayLayers(moved).find((layer) => layer.id === 'over').items.find((clip) => clip.id === 'b');
  assert.equal(landed.start, 3, 'no room before 1 s, so right after the clip it covered');
});
