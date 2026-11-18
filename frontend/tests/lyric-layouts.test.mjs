import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLyricLayout, NEXT_LAYER } from '../src/timeline/lyric-layouts.ts';
import { chorusLines } from '../src/timeline/song-sections.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const line = (id, start, text, length = 3) => ({ id, start, length, text, style: 'shadow', position: 'bottom', color: '#ffffff', size: 40, transform: REST });
const song = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [
  { id: 'main', kind: 'video', name: 'Main', magnetic: true, items: [] },
  { id: 'lyrics', kind: 'text', name: 'Lyrics', items: [line('opening-credit', 0, 'Song'), line('a', 3, 'நிலவே நீ வா'), line('b', 6, 'என் உயிரே வா'), line('c', 9, 'நிலவே நீ வா'), line('d', 20, 'முடிவு')] }] });
const items = (timeline, id) => timeline.layers.find((layer) => layer.id === id)?.items ?? [];

test('two lines: the sung line above the middle and the next one dim beneath, until a pause', () => {
  const laid = applyLyricLayout(song(), 'two-line');
  const next = items(laid, NEXT_LAYER);
  assert.deepEqual(next.map((item) => [item.start, item.length, item.text]), [[3, 3, 'என் உயிரே வா'], [6, 3, 'நிலவே நீ வா']], 'nothing waits across the long pause before the last line');
  assert.ok(next.every((item) => item.transform.opacity < 0.5 && item.size < 40 && item.transform.y > 0.5));
  const a = items(laid, 'lyrics').find((item) => item.id === 'a');
  assert.equal(a.position, 'center');
  assert.ok(a.transform.y < 0.5);
  assert.equal(items(laid, 'lyrics').find((item) => item.id === 'opening-credit').position, 'bottom', 'credits stay');
  assert.deepEqual(chorusLines(laid).map((item) => item.id), ['a', 'c'], 'the dim next lines are not counted as more chorus lines');
});

test('changing layout replaces the last, and Big centre grows the lines only once', () => {
  const lower = applyLyricLayout(applyLyricLayout(song(), 'two-line'), 'lower-third');
  assert.equal(items(lower, NEXT_LAYER).length, 0);
  const a = items(lower, 'lyrics').find((item) => item.id === 'a');
  assert.deepEqual([a.position, a.align, a.style, a.transform.y], ['bottom', 'left', 'band', 0.5]);
  const big = applyLyricLayout(song(), 'big-centre');
  const again = applyLyricLayout(big, 'big-centre');
  assert.equal(items(big, 'lyrics').find((item) => item.id === 'a').size, 52);
  assert.equal(items(again, 'lyrics').find((item) => item.id === 'a').size, 52);
});

test('a Short has its lyrics large, below the middle, clear of the subject', async () => {
  const { shortsLyrics, SHORT_LINE } = await import('../src/timeline/lyric-layouts.ts');
  const short = shortsLyrics(applyLyricLayout(song(), 'two-line'));
  assert.equal(items(short, NEXT_LAYER).length, 0);
  const a = items(short, 'lyrics').find((item) => item.id === 'a');
  assert.deepEqual([a.position, a.size, a.transform.y], ['center', 60, SHORT_LINE]);
  assert.equal(items(short, 'lyrics').find((item) => item.id === 'opening-credit').size, 40, 'credits stay');
});

test('Original always brings back the lines exactly as they were, after any layouts', async () => {
  const { currentLyricLayout } = await import('../src/timeline/lyric-layouts.ts');
  const own = song();
  own.layers[1].items = own.layers[1].items.map((item, index) => ({ ...item, position: index % 2 ? 'top' : 'bottom', align: 'right', size: 36 + index, own: ['color'], transform: { ...REST, y: 0.4, keyframes: { scale: [{ t: 0, v: 1, ease: 'linear' }, { t: 1, v: 1.1, ease: 'linear' }] } } }));
  assert.equal(currentLyricLayout(own), 'original');
  let laid = own;
  for (const layout of ['two-line', 'big-centre', 'big-centre', 'lower-third', 'two-line']) laid = applyLyricLayout(laid, layout);
  assert.equal(currentLyricLayout(laid), 'two-line');
  const back = applyLyricLayout(laid, 'original');
  assert.equal(currentLyricLayout(back), 'original');
  assert.deepEqual(back.layers.map((layer) => layer.id), own.layers.map((layer) => layer.id), 'the next-line layer is gone');
  const strip = ({ layout_original, ...rest }) => rest;  // eslint-disable-line no-unused-vars
  assert.deepEqual(items(back, 'lyrics').map(strip), items(own, 'lyrics'));
  assert.equal(items(applyLyricLayout(applyLyricLayout(own, 'big-centre'), 'big-centre'), 'lyrics')[1].size, Math.round(37 * 1.3), 'sizes come from your own, never compound');
});
