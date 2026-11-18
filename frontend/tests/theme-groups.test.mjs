import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../src/timeline/themes.ts';
import { readFileSync } from 'node:fs';

// Every theme is in exactly one Themes tab group, so none goes missing from the panel.
test('every theme is in exactly one group', () => {
  const tab = readFileSync(new URL('../src/editor/panels/tabs/ThemesTab.tsx', import.meta.url), 'utf8');
  const grouped = [...tab.matchAll(/themes: \[([^\]]*)\]/g)].flatMap((match) => [...match[1].matchAll(/'([a-z-]+)'/g)].map((each) => each[1]));
  assert.deepEqual([...grouped].sort(), THEMES.map((theme) => theme.id).sort());
});
