import test from 'node:test';
import assert from 'node:assert/strict';
import { placeEffects, removeEffects, titleTimes, transitionTimes } from '../src/timeline/sfx.ts';
import { loopRange, loopSound, needsLoop, pictureEnd } from '../src/timeline/loop.ts';
import { addSound, addText, audioLayers, emptyTimeline, insertClip, newClip } from '../src/timeline/model.ts';

const video = { media_id: 1, media_type: 'video', duration: 10 };
const format = { width: 1080, height: 1920, fps: 30 };
const withClips = (count, length = 4) => Array.from({ length: count }, (_, i) => `c${i}`).reduce((t, id, i) => insertClip(t, { ...newClip(video, id), out: length, transition_in: i ? { kind: 'crossfade', duration: 0.6 } : null }), emptyTimeline(format));
const sounds = (t) => audioLayers(t).flatMap((layer) => layer.items).sort((a, b) => a.start - b.start);
let ids = 0; const newId = () => `n${ids += 1}`;
const song = (extra = {}) => ({ id: 'song', asset_id: 'a'.repeat(32), start: 0, in: 0, out: 10, speed: 1, volume: 0.5, muted: false, fade_in: 0, fade_out: 0, duck: true, name: 'Song', source_length: 10, ...extra });

test('whooshes peak on every transition and replace the earlier ones', () => {
  const t = withClips(3);
  assert.deepEqual(transitionTimes(t), [4, 8]);
  const whoosh = { asset_id: 'w'.repeat(32), duration: 0.9, name: 'Whoosh', kind: 'whoosh', peak: 0.5 };
  const once = placeEffects(t, whoosh, transitionTimes(t), newId);
  assert.equal(once.placed, 2);
  assert.deepEqual(sounds(once.timeline).map((sound) => [sound.start, sound.in, sound.name]), [[3.5, 0, 'Whoosh'], [7.5, 0, 'Whoosh']]);
  const twice = placeEffects(once.timeline, whoosh, transitionTimes(t), newId);
  assert.equal(sounds(twice.timeline).length, 2, 'adding again replaces, never doubles');
  assert.equal(audioLayers(removeEffects(twice.timeline, 'whoosh')).length, 0, 'removing them leaves no empty tracks');
});

test('a hit at the very start is trimmed so it still peaks on time', () => {
  let t = withClips(1);
  t = addText(t, { id: 'title', start: 0.2, length: 3, text: 'Hi' }, 'texts');
  assert.deepEqual(titleTimes(t), [0.2]);
  const hit = { asset_id: 'h'.repeat(32), duration: 1, name: 'Hit', kind: 'hit', peak: 0.5 };
  const [sound] = sounds(placeEffects(t, hit, titleTimes(t), newId).timeline);
  assert.deepEqual([sound.start, sound.in], [0, 0.3]);
});

test('loops repeat whole bars from the last beat back', () => {
  const beats = Array.from({ length: 20 }, (_, i) => 0.5 + i * 0.5); // 0.5 … 10.0, 120 bpm
  assert.deepEqual(loopRange(beats, 0, 10), [1.5, 9.5], '16 beats (4 bars) back from the last beat before the end');
  assert.deepEqual(loopRange([], 1, 10), [1, 10], 'no beat: the whole song');
  assert.deepEqual(loopRange([1, 2, 3], 0, 10), [0, 10], 'too few beats for a bar');
});

test('a short song repeats on the beat until the picture ends, then fades', () => {
  let t = addSound(withClips(6), song(), 'music'); // 24 s of video, a 10 s song.
  assert.equal(pictureEnd(t), 24, 'the song itself does not count');
  assert.ok(needsLoop(t, sounds(t)[0]));
  const beats = Array.from({ length: 20 }, (_, i) => 0.5 + i * 0.5);
  const result = loopSound(t, 'song', beats, newId);
  const pieces = sounds(result.timeline);
  assert.deepEqual(pieces.map((piece) => [piece.start, piece.in, piece.out]), [[0, 0, 9.5], [9.5, 1.5, 9.5], [17.5, 1.5, 8]]);
  const last = pieces[pieces.length - 1];
  assert.equal(Math.round((last.start + (last.out - last.in)) * 1000) / 1000, 24, 'ends with the picture');
  assert.ok(last.fade_out > 1, 'and fades out');
  assert.ok(pieces.every((piece) => piece.duck && piece.volume === 0.5), 'every piece keeps the song settings');
  assert.equal(result.repeats, pieces.length - 1);
  assert.equal(needsLoop(result.timeline, last), false);
  assert.equal(loopSound(addSound(withClips(1), song(), 'm'), 'song', beats, newId).repeats, 0, 'a song longer than the video is left alone');
});
