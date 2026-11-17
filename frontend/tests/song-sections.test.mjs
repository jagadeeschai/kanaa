import test from 'node:test';
import assert from 'node:assert/strict';
import { chorusLines, chorusSections, hitTimes, placeLightHits, removeLightHits, styleChorus, LIGHT_PREFIX } from '../src/timeline/song-sections.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const line = (id, start, text) => ({ id, start, length: 3, text, style: 'shadow', position: 'bottom', color: '#ffffff', size: 40, transform: REST });
const song = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [
  { id: 'main', kind: 'video', name: 'Main', magnetic: true, items: [] },
  { id: 'lyrics', kind: 'text', name: 'Lyrics', items: [
    { ...line('opening-credit', 0, 'நிலவே நீ வா') },
    line('v1', 3, 'காற்றில் ஒரு பாட்டு'), line('v2', 6, 'கடலின் அலை போல'),
    line('c1', 10, 'நிலவே நீ வா!'), line('c2', 13, 'என் உயிரே வா'),
    line('v3', 20, 'மழையின் துளி'), line('c3', 30, 'நிலவே, நீ வா'), line('c4', 33, 'என் உயிரே வா')] }] });

test('the chorus is the lines sung more than once, credits and punctuation aside', () => {
  assert.deepEqual(chorusLines(song()).map((item) => item.id), ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(chorusSections(song()), [[10, 16], [30, 36]]);
});

test('styling the chorus makes it bigger and pop in word by word, once', () => {
  const { timeline, styled } = styleChorus(song());
  assert.equal(styled, 4);
  const c1 = timeline.layers[1].items.find((item) => item.id === 'c1');
  assert.equal(c1.size, 47);
  assert.equal(c1.enter.preset, 'word-pop');
  assert.equal(timeline.layers[1].items.find((item) => item.id === 'v1').size, 40, 'verses stay');
  assert.equal(styleChorus(timeline).styled, 0, 'a second click changes nothing');
});

test('light hits land on each chorus first beat, then every eight beats, and replace earlier ones', () => {
  const beats = Array.from({ length: 80 }, (_, index) => 0.1 + index * 0.5);
  const hits = hitTimes(chorusSections(song()), beats);
  assert.deepEqual(hits, [{ at: 10.1, strong: true }, { at: 14.1, strong: false }, { at: 30.1, strong: true }, { at: 34.1, strong: false }]);
  const effect = { id: 'fx', media_id: 9, start: 0, in: 0, out: 5, speed: 1, volume: 0, muted: true, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
  let n = 0; const id = () => `id${n++}`;
  const once = placeLightHits(song(), effect, hits, 2.5, id);
  const twice = placeLightHits(once, effect, hits, 2.5, id);
  const lights = (timeline) => timeline.layers.filter((layer) => layer.kind === 'video').flatMap((layer) => layer.items).filter((clip) => clip.id.startsWith(LIGHT_PREFIX));
  assert.equal(lights(twice).length, 4);
  assert.equal(twice.layers.filter((layer) => layer.name === 'Effects').length, 1, 'all on one Effects layer');
  assert.equal(lights(once)[0].transform.opacity, 0.75);
  const first = lights(once)[0];
  assert.equal(first.start + (2.5 - first.in), 10.1, 'the light is brightest on the beat');
  assert.equal(lights(once)[1].transform.opacity, 0.4);
  assert.deepEqual(removeLightHits(twice).layers.map((layer) => layer.id), ['main', 'lyrics']);
});

test('a song with no repeated lines has no chorus', () => {
  const plain = song(); plain.layers[1].items = plain.layers[1].items.filter((item) => item.id.startsWith('v'));
  assert.deepEqual(chorusSections(plain), []);
});

test('a Short takes the first chorus, from just before it, 15 seconds to a minute', async () => {
  const { shortRange } = await import('../src/timeline/song-sections.ts');
  assert.deepEqual(shortRange([[10, 16], [30, 36]], 40), [9.5, 24.5], 'a short chorus is lengthened to 15 seconds');
  assert.deepEqual(shortRange([[10, 40]], 100), [9.5, 41]);
  assert.deepEqual(shortRange([[10, 200]], 300), [9.5, 69.5], 'never more than a minute');
  assert.deepEqual(shortRange([[30, 36]], 40), [29.5, 40], 'not past the end');
});
