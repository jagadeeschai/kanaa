import test from 'node:test';
import assert from 'node:assert/strict';
import { sortMedia } from '../src/timeline/mediaOrder.ts';

const items = [
  { id: 1, filename: 'AI scene 10.png', media_type: 'image', created_at: '2026-11-14 09:00:00' },
  { id: 2, filename: 'AI scene 2.png', media_type: 'image', created_at: '2026-11-15 09:00:00' },
  { id: 3, filename: 'clock.mp4', media_type: 'video', created_at: '2026-11-13 09:00:00' },
  { id: 4, filename: 'Bharathidasan.png', media_type: 'image', created_at: null },
];
const ids = (list) => list.map((item) => item.id);

test('newest and oldest by when they were added', () => {
  assert.deepEqual(ids(sortMedia(items, 'newest')), [2, 1, 3, 4]);  // One without a date counts as the oldest.
  assert.deepEqual(ids(sortMedia(items, 'oldest')), [4, 3, 1, 2]);
});

test('names in natural order: scene 2 before scene 10', () => {
  assert.deepEqual(ids(sortMedia(items, 'name')), [2, 1, 4, 3]);
});

test('pictures first, then videos, each by name', () => {
  assert.deepEqual(ids(sortMedia(items, 'kind')), [2, 1, 4, 3]);
});

test('the list given is left as it was', () => {
  const before = ids(items);
  sortMedia(items, 'name');
  assert.deepEqual(ids(items), before);
});
