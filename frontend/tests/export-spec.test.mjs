import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSpec } from '../src/editor/export-spec.ts';

test('describes portrait export dimensions and audible audio', () => {
  assert.equal(exportSpec({ width: 1080, height: 1920, fps: 30 }, true), '1080 × 1920 · 30 fps · 9:16 · with sound · MP4');
});

test('reduces nonstandard aspect ratios and reports silent output', () => {
  assert.equal(exportSpec({ width: 1080, height: 1350, fps: 24 }, false), '1080 × 1350 · 24 fps · 4:5 · no audible sound · MP4');
});
