import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLyricTimeline, plainLyricLines, withoutDirections } from '../src/utils/lyrics.ts';

test('singing notes come out; sung words in brackets stay', () => {
  assert.equal(withoutDirections('(Backing harmony)  வானம் பார்க்க என்ன உண்டு'), 'வானம் பார்க்க என்ன உண்டு');
  assert.equal(withoutDirections('(Stereo wide backing: பக்கத்திலே நின்றாயடி கற்கண்டு)'), 'பக்கத்திலே நின்றாயடி கற்கண்டு');
  assert.equal(withoutDirections('[Lead Vocal Center] பக்கத்திலே நின்றாயடி கற்கண்டு'), 'பக்கத்திலே நின்றாயடி கற்கண்டு');
  assert.equal(withoutDirections('(கற்கண்டு...)'), 'கற்கண்டு...');
  assert.equal(withoutDirections('(நல்ல…. பருத்தி புடவை)'), 'நல்ல…. பருத்தி புடவை');
  assert.equal(withoutDirections('(Silent 1 second)'), '');
  assert.equal(withoutDirections('மரத்தின் நிழலில் நின்று கொண்டு'), 'மரத்தின் நிழலில் நின்று கொண்டு');
});

test('pasted Suno lyrics give only the sung lines', () => {
  const pasted = `[VERSE 1]
மரத்தின் நிழலில் நின்று கொண்டு
(Backing harmony) வந்த என்னை நீயும் கண்டு
(Silent 1 second)

[Verse 3 - Sudden Hip-hop switch, fast 16th-note rhythmic rap, dry upfront vocal]
வையகத்தில் ஏன் பிறந்தாய்?
(எனை)
[Outro Instrumental - Sharp synth pluck fade out]

[End]`;
  assert.deepEqual(plainLyricLines(pasted), ['மரத்தின் நிழலில் நின்று கொண்டு', 'வந்த என்னை நீயும் கண்டு', 'வையகத்தில் ஏன் பிறந்தாய்?', 'எனை']);
});

test('an LRC line keeps its time and loses its notes', () => {
  const cues = buildLyricTimeline('[00:44.60](Backing harmony) வந்த என்னை நீயும் கண்டு\n[00:48.03]மரத்தின் நிழலில் நின்று கொண்டு', 60);
  assert.equal(cues[0].text, 'வந்த என்னை நீயும் கண்டு');
  assert.equal(cues[0].start, 44.6);
});
