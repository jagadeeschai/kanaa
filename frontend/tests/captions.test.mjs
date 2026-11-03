import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptions, litWord, retypeCaption } from '../src/timeline/captions.ts';
import { captionStates, emptyTimeline, insertClip, newClip, normalizeTimeline, setCaptions, trimText, mainLayer } from '../src/timeline/model.ts';

const format = { width: 1080, height: 1920, fps: 30 };
const video = (id, extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 20 }, id), ...extra });
let count = 0;
const id = () => `c${(count += 1)}`;
const words = [
  ['இன்று', 1.0, 1.3], ['நாம்', 1.35, 1.6], ['ஒரு', 1.65, 1.8], ['புதிய', 1.85, 2.2], ['வீடியோ', 2.25, 2.7], ['பார்ப்போம்.', 2.75, 3.3],
  ['Then', 4.5, 4.7], ['a', 4.75, 4.8], ['new', 4.85, 5.0], ['part', 5.05, 5.4],
].map(([w, s, e]) => ({ w, s, e }));

test('speech becomes short captions that break at pauses and sentence ends', () => {
  const captions = buildCaptions([video('a')], () => words, id);
  assert.deepEqual(captions.map((caption) => caption.words.map((word) => word.w).join(' ')), ['இன்று நாம் ஒரு', 'புதிய வீடியோ பார்ப்போம்.', 'Then a new', 'part']);
  assert.equal(captions[0].start, 1);
  assert.deepEqual(captions[0].words.map((word) => word.s), [0, 0.35, 0.65]);
  // Each stays up until the next starts, or a moment after its last word.
  assert.equal(captions[0].start + captions[0].length, captions[1].start);
  assert.ok(Math.abs(captions[1].start + captions[1].length - 3.6) < 1e-6);
});

test('captions follow the clip on the timeline, trims and speed included', () => {
  const clip = video('a', { start: 0, in: 2, out: 6, speed: 2 });
  const captions = buildCaptions([clip], () => words, id, { words: 2, maxLetters: 40 });
  assert.equal(captions[0].words[0].w, 'புதிய');
  assert.ok(Math.abs(captions[0].start - (1.85 - 2) / 2) < 0.2, 'a word cut by the trim keeps only its visible part');
});

test('which word is lit, and the moments a caption changes, match the export', () => {
  const caption = { id: 'x', start: 5, length: 1.5, words: [{ w: 'ONE', s: 0 }, { w: 'TWO', s: 0.5 }, { w: 'THREE', s: 1 }] };
  assert.deepEqual([0, 0.4, 0.5, 1.2].map((t) => litWord(caption, t)), [0, 0, 1, 2]);
  assert.deepEqual(captionStates(caption, true), [[0, 0.5, 0], [0.5, 1, 1], [1, 1.5, 2]]);
  assert.deepEqual(captionStates(caption, false), [[0, 1.5, null]]);
});

test('retyping a caption keeps word times when the count is the same', () => {
  const caption = { id: 'x', start: 0, length: 2, words: [{ w: 'helo', s: 0 }, { w: 'world', s: 1.2 }] };
  assert.deepEqual(retypeCaption(caption, 'hello world'), [{ w: 'hello', s: 0 }, { w: 'world', s: 1.2 }]);
  assert.deepEqual(retypeCaption(caption, 'hello big world').map((word) => word.s), [0, 0.667, 1.333]);
});

test('one captions layer: made again it keeps its look, and trimming keeps words on their moment', () => {
  let timeline = insertClip(emptyTimeline(format), video('a'));
  timeline = setCaptions(timeline, buildCaptions(mainLayer(timeline).items, () => words, id), 'subs');
  timeline = { ...timeline, layers: timeline.layers.map((layer) => (layer.kind === 'captions' ? { ...layer, color: '#ff0000' } : layer)) };
  timeline = setCaptions(timeline, buildCaptions(mainLayer(timeline).items, () => words.slice(0, 3), id), 'other');
  const layers = timeline.layers.filter((layer) => layer.kind === 'captions');
  assert.equal(layers.length, 1); assert.equal(layers[0].color, '#ff0000'); assert.equal(layers[0].items.length, 1);
  const first = layers[0].items[0];
  const trimmed = trimText(timeline, first.id, 'in', first.start + 0.3).layers.find((layer) => layer.kind === 'captions').items[0];
  assert.deepEqual(trimmed.words.map((word) => word.s), [0, 0.05, 0.35]);
  assert.equal(normalizeTimeline({ ...timeline, layers: [...timeline.layers.slice(0, 1), { id: 'bare', kind: 'captions', items: [] }] }).layers[1].highlight, '#ffd400');
});
