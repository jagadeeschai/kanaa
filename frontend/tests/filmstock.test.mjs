import test from 'node:test';
import assert from 'node:assert/strict';
import { FILM_STOCKS, STOCK_KINDS, stockOf, withStock } from '../src/timeline/filmstock.ts';

const sky = { kind: 'new_sky', sky: 'sunset' }, slow = { kind: 'slowmo', factor: 2 };

test('a film stock sets its camera and film looks and keeps the scene looks', () => {
  const looks = withStock([sky, { kind: 'shake', preset: 'impact' }, slow], 'classic');
  assert.deepEqual(looks.map((look) => look.kind), ['new_sky', 'halation', 'weave', 'slowmo']);
  assert.equal(stockOf(looks), 'classic');
});

test('None takes the stock off; changing one look shows no stock chosen', () => {
  const looks = withStock([sky], 'docu');
  assert.deepEqual(withStock(looks, null), [sky]);
  assert.equal(stockOf([sky]), '');
  assert.equal(stockOf(looks.map((look) => (look.kind === 'shake' ? { ...look, preset: 'float' } : look))), null);
});

test('every stock uses only the kinds it manages, each once', () => {
  for (const stock of FILM_STOCKS) {
    assert.ok(stock.looks.every((look) => STOCK_KINDS.includes(look.kind)), stock.id);
    assert.equal(new Set(stock.looks.map((look) => look.kind)).size, stock.looks.length, stock.id);
    assert.equal(stockOf(withStock([], stock.id)), stock.id);
  }
});
