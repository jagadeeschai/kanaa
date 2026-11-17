import test from 'node:test';
import assert from 'node:assert/strict';
import { letterLooks, wordStart, WORD_LEAD, WORD_SECONDS } from '../src/timeline/animation.ts';

// The same numbers as backend/tests/test_word_motion.py, so the preview moves words as the export does.
const WORDS = [0, 0, 0, 0, 0, 1, 1, 1, 1];
const TIMES = [0.2, 1.0];

test('sung words arrive as they are sung, as in the export', () => {
  assert.deepEqual(wordStart(1, 2, TIMES, 0.5), [1.0 - WORD_LEAD, WORD_SECONDS]);
  const enter = { preset: 'word-rise', duration: 0.5 };
  const looks = letterLooks(enter, null, 0.5, 2, WORDS.map(() => 0), WORDS, TIMES);
  assert.ok(looks.slice(0, 5).every((look) => look.opacity === 1));
  assert.ok(looks.slice(5).every((look) => look.opacity === 0));
  const settled = letterLooks(enter, null, 1.6, 2, WORDS.map(() => 0), WORDS, TIMES);
  assert.ok(settled.every((look) => look.dx === 0 && look.dy === 0 && look.scale === 1 && look.opacity === 1));
});

test('without karaoke the words follow each other across the entrance', () => {
  const early = letterLooks({ preset: 'word-pop', duration: 1 }, null, 0.3, 2, WORDS.map(() => 0), WORDS, null);
  assert.ok(early[0].opacity > 0);
  assert.equal(early[8].opacity, 0);
});
