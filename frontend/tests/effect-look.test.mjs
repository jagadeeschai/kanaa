import test from 'node:test';
import assert from 'node:assert/strict';
import { colourChanges, currentColour, EFFECT_COLOURS } from '../src/timeline/effect-look.ts';

const ADJUST = { rotation: 0, flip_horizontal: false, flip_vertical: false, brightness: 1.2, contrast: 1, saturation: 1, gamma: 1, temperature: 1, tint: 1, fade: 0 };
const clip = { adjust: ADJUST, wheels: null };

test('each colour is recognised again, and Original takes it all back', () => {
  for (const { id } of EFFECT_COLOURS) assert.equal(currentColour({ ...clip, ...colourChanges(clip, id) }), id, id);
  const blue = { ...clip, ...colourChanges(clip, 'blue') };
  assert.equal(blue.adjust.brightness, 1.2, 'the strength stays');
  assert.deepEqual(colourChanges(blue, 'original'), { adjust: { ...ADJUST, saturation: 1 }, wheels: null });
});
