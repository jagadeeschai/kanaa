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

test('applying a plan keeps the looks the director does not plan (colour match, slow motion) and replaces the rest', () => {
  const plan = { looks: [{ kind: 'atmosphere', preset: 'mist', strength: 'light', why: 'soft' }, { kind: 'halation', preset: 'subtle', why: 'glow' }], summary: '' };
  const kept = [{ kind: 'match', reference: { media: 2, start: 0, end: 3 } }, { kind: 'halation', preset: 'classic' }, { kind: 'shake', preset: 'docu' }, { kind: 'slowmo', factor: 2 }];
  const made = looksToMake(plan, kept);
  assert.deepEqual(made.map((look) => look.kind), ['match', 'atmosphere', 'halation', 'slowmo']);
  assert.equal(made.find((look) => look.kind === 'halation').preset, 'subtle');
});
