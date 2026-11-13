import test from 'node:test';
import assert from 'node:assert/strict';
import { addText, emptyTimeline, findText, karaokeLit, karaokeWords, updateText } from '../src/timeline/model.ts';

test('word times share the sung part of a line by word length', () => {
  const words = karaokeWords('நீ பக்கத்திலே நின்றாயடி', 4);
  assert.equal(words.length, 3);
  assert.equal(words[0], 0);
  assert.ok(words[1] < 0.6 && words[2] - words[1] > words[1], 'the short word is quick, the long one takes longer');
  assert.ok(words[2] < 4 * 0.85);
});

test('the lit word follows the time, none before the first', () => {
  const text = { karaoke: { color: '#ffd54a', words: [0.2, 1, 2] } };
  assert.equal(karaokeLit(text, 0.1), null);
  assert.equal(karaokeLit(text, 1.5), 1);
  assert.equal(karaokeLit(text, 9), 2);
});

test('changing the words or the length re-times them', () => {
  let t = addText(emptyTimeline({ width: 1920, height: 1080, fps: 30 }), { id: 'a', start: 0, length: 4, text: 'ஒன்று இரண்டு', style: 'shadow', position: 'bottom', color: '#fff', size: 40, karaoke: { color: '#ffd54a', words: [0, 1] } }, 'L');
  t = updateText(t, 'a', { text: 'ஒன்று இரண்டு மூன்று' });
  assert.equal(findText(t, 'a').text.karaoke.words.length, 3);
  t = updateText(t, 'a', { length: 8 });
  assert.ok(findText(t, 'a').text.karaoke.words[2] > 3);
  t = updateText(t, 'a', { karaoke: { color: '#fff', words: [0, 0.5, 0.7] } });
  assert.deepEqual(findText(t, 'a').text.karaoke.words, [0, 0.5, 0.7], 'times set on purpose are kept');
});
