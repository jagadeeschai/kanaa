import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTabIndex } from '../src/editor/tab-navigation.ts';

test('tab arrows wrap through a two-row tab grid', () => {
  assert.equal(nextTabIndex(2, 6, 'ArrowRight', 3), 3);
  assert.equal(nextTabIndex(0, 6, 'ArrowLeft', 3), 5);
  assert.equal(nextTabIndex(1, 6, 'ArrowDown', 3), 4);
  assert.equal(nextTabIndex(4, 6, 'ArrowUp', 3), 1);
});

test('Home and End move to the ends while unrelated keys stay put', () => {
  assert.equal(nextTabIndex(3, 6, 'Home', 3), 0);
  assert.equal(nextTabIndex(3, 6, 'End', 3), 5);
  assert.equal(nextTabIndex(3, 6, 'Enter', 3), 3);
});
