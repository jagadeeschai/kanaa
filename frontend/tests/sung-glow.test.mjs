import test from 'node:test';
import assert from 'node:assert/strict';
import { glowLevels, karaokeLit, karaokePictures, GLOW_LEVELS } from '../src/timeline/karaoke.ts';

const LEVELS = [0, 0, 0, 1, 1, 2, 2, 2, 1, 0, 0, 0, 0, 1, 1, 2, 2, 2, 1, 0, 0, 0, 0, 1, 1, 2, 2, 2, 1, 0];
const line = (karaoke) => ({ id: 't', start: 0, length: 3, text: 'நிலவே நீ வா', karaoke: { color: '#ffd54a', words: [0.2, 1, 2], ...karaoke } });

test('the picture shown is the sung word and the glow then, as karaoke_states says', () => {
  assert.equal(karaokeLit(line({}), 1.5), 1, 'unchanged without a glow');
  const glowing = line({ glow: true, levels: LEVELS });
  assert.equal(karaokeLit(glowing, 0.1), null);
  assert.equal(karaokeLit(glowing, 0.25), 0 * GLOW_LEVELS + 0);
  assert.equal(karaokeLit(glowing, 0.55), 0 * GLOW_LEVELS + 2);
  assert.equal(karaokeLit(glowing, 1.35), 1 * GLOW_LEVELS + 1);
  assert.deepEqual(karaokePictures(glowing), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(karaokePictures(line({})), [0, 1, 2]);
});

test('louder parts of the song glow more, measured against the song itself', () => {
  const peaks = Array.from({ length: 100 }, (_, index) => (index >= 40 && index < 50 ? 100 : 10));  // 10 a second: loud from 4 s to 5 s.
  const levels = glowLevels({ start: 3, length: 3 }, peaks, 10, (at) => at);
  assert.equal(levels.length, 30);
  assert.equal(levels[0], 0, 'quiet at 3 s');
  assert.equal(levels[15], 2, 'loud at 4.5 s');
  assert.deepEqual(glowLevels({ start: 3, length: 1 }, peaks, 10, () => null), Array(10).fill(0), 'no song, no glow');
});
