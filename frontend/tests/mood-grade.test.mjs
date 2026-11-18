import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMood, clearMood, songParts, MOOD_LAYER } from '../src/timeline/mood-grade.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const line = (id, start, text) => ({ id, start, length: 3, text, style: 'shadow', position: 'bottom', color: '#ffffff', size: 40, transform: REST });
const song = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [
  { id: 'main', kind: 'video', name: 'Main', magnetic: true, items: [{ id: 'a', media_id: 1, start: 0, in: 0, out: 40, speed: 1, volume: 0, muted: true, fade_in: 0, fade_out: 0, transform: REST, adjust: {} }] },
  { id: 'lyrics', kind: 'text', name: 'Lyrics', items: [line('v1', 3, 'காற்றில் ஒரு பாட்டு'), line('v2', 6, 'கடலின் அலை போல'), line('c1', 10, 'நிலவே நீ வா'), line('c2', 13, 'என் உயிரே வா'),
    line('v3', 20, 'மழையின் துளி'), line('c3', 30, 'நிலவே நீ வா'), line('c4', 33, 'என் உயிரே வா')] }] });

test('the song is split into verses and choruses, each running to the next', () => {
  assert.deepEqual(songParts(song()), [[3, 10, false], [10, 20, true], [20, 30, false], [30, 40, true]]);
});

test('each part graded under the lyrics, melting into the next, and replaced or taken away in one click', () => {
  const graded = applyMood(song(), 'cool-to-warm');
  const ids = graded.layers.map((layer) => layer.id);
  assert.deepEqual(ids, ['main', MOOD_LAYER, `${MOOD_LAYER}-2`, 'lyrics'], 'under the words, so they keep their colour');
  const spans = graded.layers.filter((layer) => layer.kind === 'adjust').flatMap((layer) => layer.items).sort((a, b) => a.start - b.start);
  assert.deepEqual(spans.map((item) => [item.look, item.start]), [['cool', 3], ['warm', 9.7], ['cool', 19.7], ['warm', 29.7]]);
  assert.ok(spans[0].start + spans[0].length > spans[1].start, 'neighbours overlap by a fade');
  for (const layer of graded.layers.filter((each) => each.kind === 'adjust')) {
    layer.items.forEach((item, index) => { if (index) assert.ok(item.start >= layer.items[index - 1].start + layer.items[index - 1].length, 'no overlap inside one layer'); });
  }
  const again = applyMood(graded, 'film');
  assert.equal(again.layers.filter((layer) => layer.kind === 'adjust').length, 2, 'replaced, not added');
  assert.deepEqual(clearMood(again).layers.map((layer) => layer.id), ['main', 'lyrics']);
});

test('the mood chosen is known again, so it can be highlighted', async () => {
  const { currentMood } = await import('../src/timeline/mood-grade.ts');
  assert.equal(currentMood(song()), null);
  for (const mood of ['warm-rich', 'cool-to-warm', 'film']) assert.equal(currentMood(applyMood(song(), mood)), mood);
});
