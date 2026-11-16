import test from 'node:test';
import assert from 'node:assert/strict';
import { chartDataText, parseChartData } from '../src/timeline/chart-data.ts';

test('chart rows accept commas, tabs, Tamil and Indian-grouped values', () => {
  const parsed = parseChartData('சென்னை, 2,00,000\nமதுரை\t-12.5', 8);
  assert.deepEqual(parsed.rows, [{ label: 'சென்னை', value: 200000 }, { label: 'மதுரை', value: -12.5 }]);
  assert.equal(chartDataText(parsed.rows), 'சென்னை, 200000\nமதுரை, -12.5');
});

test('chart rows reject empty, non-numeric and excess data plainly', () => {
  assert.match(parseChartData('', 8).error, /at least one/);
  assert.match(parseChartData('சென்னை, many', 8).error, /label and a number/);
  assert.match(parseChartData(Array.from({ length: 9 }, (_, n) => `row ${n}, ${n}`).join('\n'), 8).error, /no more than 8/);
});
