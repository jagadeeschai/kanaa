import test from 'node:test';
import assert from 'node:assert/strict';
import { describeLook, looksToMake } from '../src/timeline/director.ts';

const plan = { summary: 'Quiet morning.', looks: [
  { kind: 'new_sky', sky: 'sunset', why: 'Warmer sky.' },
  { kind: 'atmosphere', preset: 'mist', strength: 'light', tune: { density: 0.5 }, why: 'Soft depth.' },
] };

test('the plan becomes the looks to make, without its reasons, and reads in words', () => {
  assert.deepEqual(looksToMake(plan), [{ kind: 'new_sky', sky: 'sunset' }, { kind: 'atmosphere', preset: 'mist', strength: 'light', tune: { density: 0.5 } }]);
  assert.equal(describeLook(plan.looks[0]), 'New sky · sunset');
  assert.equal(describeLook(plan.looks[1]), 'Atmosphere · mist, light · tuned');
});

test("applying a plan keeps the looks the director does not plan (halation, shake, blur...)", () => {
  const plan = { looks: [{ kind: 'atmosphere', preset: 'mist', strength: 'light', why: 'soft' }], summary: '' };
  const kept = [{ kind: 'halation', preset: 'classic' }, { kind: 'lens', preset: 'portrait', strength: 'medium' }, { kind: 'shake', preset: 'docu' }];
  assert.deepEqual(looksToMake(plan, kept).map((look) => look.kind), ['atmosphere', 'halation', 'shake']);
});
