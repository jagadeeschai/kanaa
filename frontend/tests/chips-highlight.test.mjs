import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The chosen chip is highlighted by the class `on` (.ed-chips button.on); `active` has no style, so the choice wouldn't show.
const files = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : []; });

test('chosen chips use the class that highlights them', () => {
  const found = files(new URL('../src/editor', import.meta.url).pathname).filter((path) => /\? 'active' :/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(found, []);
});
