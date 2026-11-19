import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricCaptions, toSrt, youtubeDetails } from '../src/publish/youtube-details.ts';

const line = (start, length, text, extra = {}) => ({ id: `t${start}`, start, length, text, style: 'band', position: 'bottom', color: '#fff', size: 44, karaoke: { color: '#ff0', words: [0] }, ...extra });
const song = (items, format = { width: 1920, height: 1080, fps: 30 }) => ({ version: 2, format, layers: [{ id: 'main', kind: 'video', items: [] }, { id: 'l', kind: 'text', name: 'Lyrics', items }] });

test('SRT: times, numbering, and lines never overlap', () => {
  const srt = toSrt([{ start: 1.5, end: 4, text: 'one\ntwo' }, { start: 3, end: 3605.25, text: 'three' }]);
  assert.equal(srt, '1\n00:00:01,500 --> 00:00:03,000\none\ntwo\n\n2\n00:00:03,000 --> 01:00:05,250\nthree\n');
});

test('Tamil lyrics give a Tamil track, and an English one when most lines carry a translation', () => {
  const items = [line(2, 3, 'வணக்கம்', { subtitle: 'Hello' }), line(6, 2, 'நன்றி', { subtitle: 'Thanks' }), line(0, 1, 'credits', { karaoke: null, layout: 'credits' })];
  const tracks = lyricCaptions(song(items));
  assert.deepEqual(tracks.map((track) => track.language), ['ta', 'en']);
  assert.match(tracks[0].srt, /^1\n00:00:02,000 --> 00:00:05,000\nவணக்கம்/);
  assert.doesNotMatch(tracks[0].srt, /credits/);
  assert.match(tracks[1].srt, /Thanks/);
  assert.deepEqual(lyricCaptions(song([line(0, 1, 'plain title', { karaoke: null })])), []);
});

test('details: title, credits in the description, tags, and Shorts for short upright videos', () => {
  const items = [line(1, 2, 'பாடல் வரி'), line(0, 5, 'Lyrics: Kavi\nMusic: Isai', { karaoke: null, layout: 'credits' })];
  const wide = youtubeDetails('தமிழும் நானும்', song(items), 200);
  assert.equal(wide.title, 'தமிழும் நானும்');
  assert.match(wide.description, /Lyrics: Kavi/);
  assert.equal(wide.language, 'ta');
  assert.ok(wide.tags.includes('tamil lyric video'));
  assert.equal(wide.short, false);
  const upright = youtubeDetails('Song', song(items, { width: 1080, height: 1920, fps: 30 }), 50);
  assert.equal(upright.short, true);
  assert.match(upright.description, /#Shorts/);
});
