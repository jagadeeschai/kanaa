import test from 'node:test';
import assert from 'node:assert/strict';
import { beatSound, cutToBeats, timelineBeats } from '../src/timeline/beats.ts';
import { addSound, emptyTimeline, insertClip, mainLayer, newClip, clipLength } from '../src/timeline/model.ts';

const video = { media_id: 1, media_type: 'video', duration: 10 };
const photo = { media_id: 2, media_type: 'image' };
const facts = (id) => (id === 1 ? video : photo);
const song = (extra = {}) => ({ id: 's', asset_id: 'song', start: 0, in: 0, out: 30, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, duck: true, name: 'Song', ...extra });
const ends = (t) => mainLayer(t).items.map((clip) => Math.round((clip.start + clipLength(clip)) * 1000) / 1000);

test('beats are placed where the song plays', () => {
  assert.deepEqual(timelineBeats(song({ start: 2, in: 1, out: 5 }), [0.5, 1, 2, 4.5, 6]), [2, 3, 5.5]);
  assert.deepEqual(timelineBeats(song({ speed: 2 }), [2, 4]), [1, 2]);
});

test('each clip ends on the nearest beat, growing or shrinking', () => {
  let t = emptyTimeline({ width: 1080, height: 1920, fps: 30 });
  t = insertClip(t, { ...newClip(video, 'a'), out: 3.2 }); // ends 3.2
  t = insertClip(t, { ...newClip(photo, 'b'), out: 2.6 }); // 3.2 → 5.8
  const beats = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5];
  const { timeline, changed } = cutToBeats(t, beats, facts);
  assert.equal(changed, 2);
  assert.deepEqual(ends(timeline), [3, 5.5]);
  assert.equal(mainLayer(timeline).items[1].start, 3, 'the next clip moves up to follow');
});

test('a clip cannot grow past its source, or shrink below half a second', () => {
  let t = insertClip(emptyTimeline({ width: 1080, height: 1920, fps: 30 }), { ...newClip(video, 'a'), in: 9.5, out: 9.9 });
  const { timeline } = cutToBeats(t, [0.2, 0.5, 0.6, 3], facts);
  assert.deepEqual(ends(timeline), [0.5], 'not 0.2 (too short), nor 0.6 or 3 (only 0.5 s of source left)');
});

test('past the last beat, clips stay as they are; a locked track is left alone', () => {
  let t = emptyTimeline({ width: 1080, height: 1920, fps: 30 });
  t = insertClip(t, { ...newClip(video, 'a'), out: 4 });
  t = insertClip(t, { ...newClip(video, 'b'), out: 4 });
  assert.deepEqual(ends(cutToBeats(t, [3.9], facts).timeline), [3.9, 7.9]);
  const locked = { ...t, layers: t.layers.map((layer) => ({ ...layer, locked: true })) };
  assert.equal(cutToBeats(locked, [3.9], facts).changed, 0);
});

test('a reversed clip keeps the end it opens with', () => {
  const t = insertClip(emptyTimeline({ width: 1080, height: 1920, fps: 30 }), { ...newClip(video, 'a'), in: 2, out: 6, reverse: true });
  const clip = mainLayer(cutToBeats(t, [3], facts).timeline).items[0];
  assert.deepEqual([clip.in, clip.out], [3, 6]);
});

test('the beat song is the longest song with its own file', () => {
  let t = emptyTimeline({ width: 1080, height: 1920, fps: 30 });
  assert.equal(beatSound(t), null);
  t = addSound(t, song({ id: 'short', out: 5 }), 'l1');
  t = addSound(t, song({ id: 'long', start: 6, out: 40 }), 'l2');
  t = addSound(t, { ...song({ id: 'clip-sound', out: 90 }), asset_id: undefined, media_id: 1 }, 'l3');
  assert.equal(beatSound(t).id, 'long');
});
