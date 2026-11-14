import test from 'node:test';
import assert from 'node:assert/strict';
import { fromTemplate, lookOf, motionOf } from '../src/timeline/templates.ts';

const designed = {
  id: 't1', start: 42, length: 6.5, text: 'கற்கண்டு', subtitle: 'Karkandu', style: 'shadow', position: 'center', color: '#ffd54a', size: 72,
  enter: { preset: 'pop', duration: 0.6 }, exit: { preset: 'fade', duration: 0.5 },
  transform: { x: 0.3, y: 0.7, scale: 1.2, opacity: 1, rotation: 0, keyframes: { x: [{ t: 0, v: 0.3, ease: 'easeOut' }, { t: 4, v: 0.6 }], scale: [{ t: 0, v: 1.2 }, { t: 6.5, v: 1 }] } },
};

test('a saved title comes back in another project moving the same way, at the new place in time', () => {
  const template = { id: 'mine-1', label: 'Mine', look: lookOf(designed), motion: motionOf(designed) };
  const reused = fromTemplate(template, 't9', 10, 4);
  assert.equal(reused.start, 10);
  assert.equal(reused.length, 6.5);
  assert.deepEqual(reused.transform, designed.transform);  // Keys are in the title's own seconds.
  assert.equal(reused.text, 'கற்கண்டு');  // The words stay until they are changed.
  assert.equal(reused.color, '#ffd54a');
  assert.equal(reused.enter.preset, 'pop');
});

test('the reused title is its own copy: editing its moves leaves the saved one alone', () => {
  const template = { id: 'mine-1', label: 'Mine', look: lookOf(designed), motion: motionOf(designed) };
  fromTemplate(template, 't9', 0, 4).transform.keyframes.x[0].v = 0.9;
  assert.equal(template.motion.transform.keyframes.x[0].v, 0.3);
});

test('styles saved before moves were kept, and built-in templates, use the default length and place', () => {
  const reused = fromTemplate({ id: 'old', label: 'Old', look: lookOf(designed) }, 't9', 3, 4);
  assert.equal(reused.length, 4);
  assert.equal(reused.transform, undefined);
});
