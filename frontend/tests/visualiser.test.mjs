import test from 'node:test';
import assert from 'node:assert/strict';
import { currentVisualiser, placeVisualiser, removeVisualiser, songOf } from '../src/timeline/visualiser.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const song = { id: 's', asset_id: 'a'.repeat(32), start: 2, in: 10, out: 70, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, duck: false, name: 'Song' };
const base = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [
  { id: 'main', kind: 'video', items: [{ id: 'c', media_id: 1, start: 0, in: 0, out: 80, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} }] },
  { id: 'words', kind: 'text', items: [] }, { id: 'music', kind: 'audio', items: [{ ...song, id: 'short', out: 12 }, song] }] });
let n = 0; const ids = () => ({ clip: `c${n}`, layer: `l${n++}` });

test('follows the longest song, spans it, sits above the pictures and under the words', () => {
  const timeline = base();
  assert.equal(songOf(timeline).id, 's');
  const placed = placeVisualiser(timeline, songOf(timeline), { id: 9, duration: 60 }, 'bars', '#7DD3FC', ids());
  assert.deepEqual(placed.layers.map((layer) => layer.kind), ['video', 'video', 'text', 'audio']);
  const layer = placed.layers[1];
  assert.equal(layer.blend, 'screen');
  assert.deepEqual([layer.items[0].start, layer.items[0].in, layer.items[0].out, layer.items[0].muted], [2, 0, 60, true]);
  assert.deepEqual(currentVisualiser(placed), { style: 'bars', colour: '#7dd3fc' });
});

test('a new style replaces the old one and keeps where it was moved; None removes it', () => {
  let timeline = placeVisualiser(base(), song, { id: 9 }, 'bars', '#7dd3fc', ids());
  timeline.layers[1].items[0].transform = { ...REST, y: 0.8, scale: 0.6 };
  timeline = placeVisualiser(timeline, song, { id: 10 }, 'circle', '#ffd54a', ids());
  assert.equal(timeline.layers.filter((layer) => layer.name === 'Visualiser').length, 1);
  assert.equal(timeline.layers[1].items[0].media_id, 10);
  assert.equal(timeline.layers[1].items[0].transform.scale, 0.6);
  assert.equal(currentVisualiser(timeline).style, 'circle');
  assert.equal(currentVisualiser(removeVisualiser(timeline)), null);
  assert.equal(songOf({ ...base(), layers: base().layers.slice(0, 2) }), null);
});
