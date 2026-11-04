import test from 'node:test';
import assert from 'node:assert/strict';
import { CREDIT_SECONDS, lyricEditorTimeline } from '../src/editor/lyric-handoff.ts';

const photo = (id) => ({ id, media_type: 'image', width: 1200, height: 800 });
const input = { name: 'My song', backgrounds: [photo(1), photo(2)], backgroundType: 'image', duration: 10, slideStarts: [0, 4], song: { id: 'a'.repeat(32), duration: 10, name: 'song.wav' }, cues: [{ text: 'First line', start: 0, end: 4 }, { text: 'Second line', start: 4, end: 10 }], canvas: 'landscape', color: '#ffd400', fontSize: 42, placement: 'bottom', lyricStyle: 'band', lyricFont: 'modern', lyricAlign: 'center', lyricBandColor: '#123456', lyricAnimation: 'pop', crossfade: true, imageAnimation: 'zoom-in' };

test('lyric handoff adds editable opening and closing cards around the song', () => {
  const timeline = lyricEditorTimeline(input);
  assert.deepEqual(timeline.format, { width: 1920, height: 1080, fps: 30 });
  assert.equal(timeline.layers[0].items.length, 4);
  assert.equal(timeline.layers[1].items[0].start, CREDIT_SECONDS);
  const titles = timeline.layers[2].items;
  assert.equal(titles[0].text, 'My song');
  assert.equal(titles.at(-1).text, 'Credits');
  assert.equal(titles.at(-1).start, 13);
});

test('lyric handoff preserves editable timing and typography', () => {
  const timeline = lyricEditorTimeline(input);
  const lines = timeline.layers[2].items.slice(1, -1);
  assert.deepEqual(lines.map((line) => [line.start, line.length]), [[3, 4], [7, 6]]);
  assert.equal(lines[0].font, 'Catamaran');
  assert.equal(lines[0].band_color, '#123456');
  assert.equal(lines[0].enter.preset, 'pop');
  assert.equal(timeline.layers[0].items[2].transition_in.kind, 'crossfade');
});
