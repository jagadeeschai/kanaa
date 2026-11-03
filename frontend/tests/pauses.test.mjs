import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTokens, cutTokens, isFiller, tidyUp } from '../src/timeline/words.ts';
import { clipLength, emptyTimeline, insertClip, mainLayer, newClip } from '../src/timeline/model.ts';
import { sourceAt } from '../src/timeline/ramp.ts';

const format = { width: 1080, height: 1920, fps: 30 };
const clip = { ...newClip({ media_id: 1, media_type: 'video', duration: 12 }, 'talk'), out: 12 };
// Speech with a 0.5 s pause, a 1.2 s pause holding an "um", and dead air at the end.
const words = [['Hello', 0.2, 0.6], ['everyone', 0.65, 1.2], ['today', 1.7, 2.1], ['Um,', 2.6, 2.9], ['we', 3.4, 3.6], ['start', 3.65, 4.1]].map(([w, s, e]) => ({ w, s, e }));
let count = 0;
const id = () => `n${(count += 1)}`;

test('fillers are found in English and Tamil, whatever the punctuation', () => {
  assert.deepEqual(['Um,', 'UH.', 'ம்ம்', 'hmm…', 'umbrella', 'அது'].map(isFiller), [true, true, true, true, false, false]);
});

test('the pause length chooses which pauses go, and fillers are optional', () => {
  const longOnly = tidyUp(buildTokens([clip], () => words, 1), [clip], false);
  assert.deepEqual([longOnly.pauses, longOnly.fillers], [1, 0], 'only the dead air at the end is a second long');
  const shorter = tidyUp(buildTokens([clip], () => words, 0.4), [clip], true);
  assert.equal(shorter.fillers, 1);
  assert.ok(shorter.pauses >= 4, 'the half-second pauses count at 0.4 s');
  assert.ok(Math.abs(longOnly.seconds - (12 - 4.1 - 0.3)) < 1e-6, 'a breath stays at each end of a cut pause');
});

test('removing pauses and an um shortens the video and keeps every word in order', () => {
  const timeline = insertClip(emptyTimeline(format), clip);
  const tokens = buildTokens([clip], () => words, 0.4);
  const tidy = tidyUp(tokens, [clip], true);
  const next = cutTokens(timeline, tokens, tidy.keys, id);
  const clips = mainLayer(next).items;
  const total = clips.reduce((sum, item) => sum + clipLength(item), 0);
  assert.ok(Math.abs(total - (12 - tidy.seconds)) < 0.15, `${total} vs ${12 - tidy.seconds}`);
  const kept = buildTokens(clips, () => words).filter((token) => token.text).map((token) => token.text);
  assert.deepEqual(kept, ['Hello', 'everyone', 'today', 'we', 'start']);
  // The cuts land between words, never inside one.
  for (const item of clips) for (const word of words) {
    const inside = word.s < item.out && word.e > item.in;
    if (inside && word.w !== 'Um,') assert.ok(word.s >= item.in - 0.05 && word.e <= item.out + 0.05, `${word.w} is whole`);
  }
  assert.ok(sourceAt(clips[0], 0) <= 0.2);
});
