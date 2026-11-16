import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAPHIC_STATES, graphicState, graphicStateCount } from '../src/timeline/graphics.ts';

const graphic = { id: 'arrow', start: 0, length: 3, text: 'arrow', style: 'plain', position: 'center', color: '#fff', size: 44,
  enter: { preset: 'reveal', duration: .8 }, graphic: { kind: 'arrow-straight', style: 'clean', from: [.2, .2], to: [.7, .7], width: .25, height: .18, line_width: .006 } };

test('draw-on advances through the same 24 eased states as the renderer', () => {
  assert.equal(GRAPHIC_STATES, 24);
  assert.deepEqual([0, .2, .4, .6, .8, 1].map((at) => graphicState(graphic, at)), [0, 13, 20, 23, 23, 23]);
  const states = Array.from({ length: 25 }, (_, n) => graphicState(graphic, n / 30));
  assert.deepEqual(states, [...states].sort((a, b) => a - b));
});

test('count-up uses about one state per entrance frame, capped at 90', () => {
  const countUp = { ...graphic, enter: { preset: 'reveal', duration: 2 }, graphic: { ...graphic.graphic, kind: 'count-up' } };
  assert.equal(graphicStateCount(countUp, 30), 61);
  assert.equal(graphicState(countUp, 2, 30), 60);
  assert.equal(graphicStateCount({ ...countUp, enter: { preset: 'reveal', duration: 8 } }, 60), 90);
  assert.equal(graphicStateCount(graphic, 60), 24);
});

test('pop and fade use the complete picture rather than stroke states', () => {
  assert.equal(graphicState({ ...graphic, enter: { preset: 'pop', duration: .5 } }, .1), null);
  assert.equal(graphicState({ ...graphic, enter: { preset: 'fade', duration: .5 } }, .1), null);
});

test('Follow uses a graphic\'s own box: the outline\'s bounds, a highlight\'s size, an arrow\'s point', async () => {
  const { graphicBox } = await import('../src/timeline/graphics.ts');
  const outline = { ...graphic.graphic, kind: 'outline', shape: [[.3, .2], [.5, .2], [.5, .6], [.3, .6]] };
  assert.deepEqual(graphicBox(outline, [0, 0]).map((v) => Math.round(v * 100) / 100), [.4, .4, .2, .4]);
  assert.deepEqual(graphicBox({ ...graphic.graphic, kind: 'spotlight', to: [.5, .5], width: .3, height: .4 }, [.1, 0]), [.6, .5, .3, .4]);
  assert.deepEqual(graphicBox(graphic.graphic, [0, -.1]).map((v) => Math.round(v * 100) / 100), [.7, .6, .12, .12]);
});
