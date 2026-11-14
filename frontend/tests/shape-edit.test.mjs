import test from 'node:test';
import assert from 'node:assert/strict';
import { drawnPoints } from '../src/timeline/shapeEdit.ts';
import { groundShape } from '../src/timeline/model.ts';

const withCover = (mask) => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [
  { id: 'main', kind: 'video', items: [] },
  { id: 'words', kind: 'text', items: [{ id: 't', start: 0, length: 3, text: 'x' }] },
  { id: 'front', kind: 'video', name: 'In front', items: [{ id: 'c', media_id: 1, start: 0, in: 0, out: 3, shape_mask: { points: mask, feather: 0.004 } }] }] });

test('a drawn skyline opens again as the line that was drawn, in order', () => {
  const line = [[0.1, 0.6], [0.4, 0.45], [0.8, 0.55]];
  assert.deepEqual(drawnPoints(withCover(groundShape(line)), 't', 'ground'), line);
  assert.equal(drawnPoints(withCover(groundShape(line)), 't', 'outline'), null);
});

test('a drawn outline opens again with its corners', () => {
  const outline = [[0.2, 0.2], [0.5, 0.25], [0.45, 0.6]];
  assert.deepEqual(drawnPoints(withCover(outline), 't', 'outline'), outline);
  assert.equal(drawnPoints(withCover(outline), 't', 'ground'), null);
});

test('no drawn cover, nothing to open', () => {
  const plain = withCover([[0, 0], [1, 0], [1, 1]]);
  plain.layers[2].name = 'Person';
  assert.equal(drawnPoints(plain, 't', 'outline'), null);
});
