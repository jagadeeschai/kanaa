import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Every dropdown is Kanaa's own (components/KanaaSelect.tsx), so they all look alike in both themes. A native <select>
// opens the system's own menu (black on a Mac), which looks out of place.
const files = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : []; });

test('no native dropdowns: use KanaaSelect', () => {
  const found = files(new URL('../src', import.meta.url).pathname).filter((path) => !path.endsWith('KanaaSelect.tsx') && /<select[\s>]/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(found, []);
});
