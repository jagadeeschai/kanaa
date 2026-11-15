import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUST_PRESETS, addAdjust, adjustStrength, findAdjust, newAdjust, removeAdjust, updateAdjust, withPreset } from '../src/timeline/adjust.ts';
import { moveItem, trimText } from '../src/timeline/model.ts';

const base = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [
  { id: 'main', kind: 'video', items: [] },
  { id: 'over', kind: 'video', items: [] },
  { id: 'words', kind: 'text', items: [] }] });

test('fades in and out as adjust_layer.strength does', () => {
  const span = { ...newAdjust('a', 2, ADJUST_PRESETS[0], 2), fade_in: 0.5, fade_out: 0.5 };
  assert.deepEqual([1.9, 2, 2.25, 3, 3.75, 4].map((t) => adjustStrength(span, t)), [0, 0, 0.5, 1, 0.5, 0]);
  assert.equal(adjustStrength({ ...span, start: 0, length: 1, fade_in: 2, fade_out: 2 }, 0.5), 1);
});

test('goes above the video layers and below the titles, and a second span reuses a free layer', () => {
  let timeline = addAdjust(base(), newAdjust('a', 0), 'adj');
  assert.deepEqual(timeline.layers.map((layer) => layer.id), ['main', 'over', 'adj', 'words']);
  timeline = addAdjust(timeline, newAdjust('b', 10), 'adj2');
  assert.equal(timeline.layers.filter((layer) => layer.kind === 'adjust').length, 1);
  timeline = addAdjust(timeline, newAdjust('c', 1), 'adj3');  // Overlaps a: a layer of its own.
  assert.equal(timeline.layers.filter((layer) => layer.kind === 'adjust').length, 2);
});

test('a preset replaces the look but keeps the timing; removing the last span removes its layer', () => {
  let timeline = addAdjust(base(), newAdjust('a', 3), 'adj');
  const night = ADJUST_PRESETS.find((preset) => preset.id === 'night');
  timeline = updateAdjust(timeline, 'a', withPreset(findAdjust(timeline, 'a').span, night));
  const span = findAdjust(timeline, 'a').span;
  assert.equal(span.look, 'cool'); assert.equal(span.start, 3); assert.equal(span.name, 'Cool night');
  assert.equal(removeAdjust(timeline, 'a').layers.some((layer) => layer.kind === 'adjust'), false);
});

test('moves and trims like any span on the timeline', () => {
  let timeline = addAdjust(base(), newAdjust('a', 3), 'adj');
  timeline = moveItem(timeline, 'a', 6);
  assert.equal(findAdjust(timeline, 'a').span.start, 6);
  timeline = trimText(timeline, 'a', 'out', 8);
  assert.equal(findAdjust(timeline, 'a').span.length, 2);
});
