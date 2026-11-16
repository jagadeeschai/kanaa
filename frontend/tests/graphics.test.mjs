import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAPHIC_STATES, graphicState } from '../src/timeline/graphics.ts';

const graphic = { id: 'arrow', start: 0, length: 3, text: 'arrow', style: 'plain', position: 'center', color: '#fff', size: 44,
  enter: { preset: 'reveal', duration: .8 }, graphic: { kind: 'arrow-straight', style: 'clean', from: [.2, .2], to: [.7, .7], width: .25, height: .18, line_width: .006 } };

test('draw-on advances through the same 24 eased states as the renderer', () => {
  assert.equal(GRAPHIC_STATES, 24);
  assert.deepEqual([0, .2, .4, .6, .8, 1].map((at) => graphicState(graphic, at)), [0, 13, 20, 23, 23, 23]);
  const states = Array.from({ length: 25 }, (_, n) => graphicState(graphic, n / 30));
  assert.deepEqual(states, [...states].sort((a, b) => a - b));
});

test('pop and fade use the complete picture rather than stroke states', () => {
  assert.equal(graphicState({ ...graphic, enter: { preset: 'pop', duration: .5 } }, .1), null);
  assert.equal(graphicState({ ...graphic, enter: { preset: 'fade', duration: .5 } }, .1), null);
});
