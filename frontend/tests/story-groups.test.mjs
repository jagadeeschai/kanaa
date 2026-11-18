import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STORIES } from '../src/timeline/stories.ts';

// Each story template shows in the Templates tab of its theme's group (ThemesTab.tsx THEME_TABS), so none goes missing.
test('every story template lands in a tab', () => {
  const tab = readFileSync(new URL('../src/editor/panels/tabs/ThemesTab.tsx', import.meta.url), 'utf8');
  const grouped = [...tab.matchAll(/themes: \[([^\]]*)\]/g)].flatMap((match) => [...match[1].matchAll(/'([a-z-]+)'/g)].map((each) => each[1]));
  assert.ok(grouped.length >= 7);
  for (const story of STORIES) assert.ok(grouped.includes(story.theme), `${story.id} (${story.theme}) has a tab`);
});
