import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaCanvas } from '../src/editor/lyric-canvas.ts';

test('lyric canvas follows the source media orientation', () => {
  assert.equal(mediaCanvas(1920, 1080), 'landscape');
  assert.equal(mediaCanvas(1080, 1920), 'portrait');
  assert.equal(mediaCanvas(1200, 1200), 'square');
});

test('lyric canvas safely falls back when dimensions are unavailable', () => {
  assert.equal(mediaCanvas(null, null), 'portrait');
  assert.equal(mediaCanvas(1920, 0), 'portrait');
});
