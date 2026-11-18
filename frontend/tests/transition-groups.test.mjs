import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every transition in the catalog appears in exactly one Transitions tab group, so none goes missing from the panel.
test('every transition is in exactly one group', () => {
  const catalog = readFileSync(new URL('../src/editor/transition-catalog.tsx', import.meta.url), 'utf8');
  const start = catalog.indexOf('export const TRANSITIONS');
  const ids = [...catalog.slice(start, catalog.indexOf('];', start)).matchAll(/\{\s*id:\s*'([a-z-]+)',\s*label/g)].map((match) => match[1]);
  const tab = readFileSync(new URL('../src/editor/panels/tabs/TransitionsTab.tsx', import.meta.url), 'utf8');
  const grouped = [...tab.matchAll(/kinds: \[([^\]]*)\]/g)].flatMap((match) => [...match[1].matchAll(/'([a-z-]+)'/g)].map((each) => each[1]));
  assert.ok(ids.length >= 20, `found ${ids.length} transitions`);
  assert.deepEqual([...grouped].sort(), [...ids].sort());
});
