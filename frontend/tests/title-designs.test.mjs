import test from 'node:test';
import assert from 'node:assert/strict';
import { dateWords, isDateTemplate, TEMPLATES } from '../src/timeline/templates.ts';
import { TITLE_DESIGNS } from '../src/timeline/model.ts';

test('a date title reads the clip\'s own local time, in English or Tamil', () => {
  assert.deepEqual(dateWords('2024-12-15T17:32', 'en'), { text: '15 December 2024', subtitle: 'Sunday · 5:32 pm' });
  assert.deepEqual(dateWords('2026-01-15T00:05', 'ta'), { text: '15 ஜனவரி 2026', subtitle: 'வியாழன் · 12:05 am' });
  assert.equal(dateWords('2026-03-12T12:00', 'en').subtitle, 'Thursday · 12:00 pm');
});

test('with no recorded date, today is used', () => {
  const now = new Date(2026, 10, 9, 21, 7);
  assert.deepEqual(dateWords(null, 'en', now), { text: '9 November 2026', subtitle: 'Monday · 9:07 pm' });
});

test('the new templates use the laid-out designs, and the date ones are known', () => {
  const designs = new Set(TITLE_DESIGNS.map((design) => design.id));
  const laid = TEMPLATES.filter((template) => template.look.design);
  assert.deepEqual(laid.map((template) => template.id), ['gradient-black', 'gradient-white', 'formal', 'overlap', 'four-corners', 'clouds', 'paper', 'torn-black', 'torn-tan', 'organic', 'organic-lower', 'date', 'date-tamil']);
  for (const template of laid) assert.ok(designs.has(template.look.design), template.id);
  assert.ok(isDateTemplate('date') && isDateTemplate('date-tamil') && !isDateTemplate('formal'));
  assert.equal(new Set(TEMPLATES.map((template) => template.id)).size, TEMPLATES.length);
});

test('pull focus softens the picture behind while the title sharpens, then lets it go', async () => {
  const { defocusBox, DEFOCUS_AMOUNT } = await import('../src/timeline/templates.ts');
  const { valueAt } = await import('../src/timeline/evaluate.ts');
  const box = defocusBox('b', 2, 4, 1, 0.6);
  assert.equal(box.width, 1); assert.equal(box.height, 1); assert.equal(box.amount, DEFOCUS_AMOUNT);
  assert.equal(valueAt(box.transform, 'opacity', 0), 0);
  assert.equal(valueAt(box.transform, 'opacity', 1), 1);
  assert.equal(valueAt(box.transform, 'opacity', 3.4), 1);
  assert.equal(valueAt(box.transform, 'opacity', 4), 0);
  const short = defocusBox('c', 0, 1, 2, 2);
  assert.ok(short.transform.keyframes.opacity.every((key, index, all) => index === 0 || key.t >= all[index - 1].t), 'fades never cross on a short title');
});

test('the effect titles say what they bring', async () => {
  const { TEMPLATES } = await import('../src/timeline/templates.ts');
  const extra = Object.fromEntries(TEMPLATES.filter((template) => template.extra).map((template) => [template.id, template.extra]));
  assert.deepEqual(extra, { 'lens-flare': { effect: 'lens-flare' }, 'pixie-dust': { effect: 'sparkles' }, 'boogie-lights': { effect: 'bokeh' }, 'pull-focus': { defocus: true } });
});
