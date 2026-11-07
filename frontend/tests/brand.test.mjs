import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBrand, brandClip, brandCorner, brandOnClip, brandsOnClip, BRAND_CLIPS_LAYER_ID, coverBrand, fadeBrand, moveBrand, removeBrand, removeClipBrand, resizeBrand, BRAND_LAYER_ID } from '../src/timeline/brand.ts';
import { duration, emptyTimeline, insertClip, newClip } from '../src/timeline/model.ts';

const format = { width: 1920, height: 1080, fps: 30 };
const video = (id, extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, id), ...extra });
const logo = { media_id: 9, width: 400, height: 400 };
const withVideo = (clips) => clips.reduce((timeline, clip) => insertClip(timeline, clip), emptyTimeline(format));

test('applyBrand puts the logo on its own layer at the corner, over the whole video', () => {
  const timeline = applyBrand(withVideo([video('a'), video('b')]), logo, 'top-right', 0.18, 'logo1');
  const layer = timeline.layers.find((entry) => entry.id === BRAND_LAYER_ID);
  assert.ok(layer, 'brand layer exists');
  assert.equal(layer.items[0].id, 'logo1');
  assert.equal(layer.items[0].start, 0);
  assert.equal(layer.items[0].out - layer.items[0].in, duration(timeline));
  assert.ok(layer.items[0].transform.x > 0.9 && layer.items[0].transform.y < 0.16, 'tucked in the top right');
  // The brand layer is the topmost video layer.
  const videoIndexes = timeline.layers.map((entry, index) => (entry.kind === 'video' ? index : -1)).filter((index) => index >= 0);
  assert.equal(Math.max(...videoIndexes), timeline.layers.indexOf(layer));
});

test('re-applying replaces the old brand instead of stacking', () => {
  const once = applyBrand(withVideo([video('a')]), logo, 'top-left', 0.18, 'logo1');
  const twice = applyBrand(once, { ...logo, media_id: 10 }, 'bottom-left', 0.12, 'logo2');
  assert.equal(twice.layers.filter((entry) => entry.id === BRAND_LAYER_ID).length, 1);
  assert.equal(brandClip(twice).media_id, 10);
});

test('move and resize keep the logo inside the frame at a corner', () => {
  let timeline = applyBrand(withVideo([video('a')]), logo, 'bottom-left', 0.18, 'logo1');
  timeline = resizeBrand(timeline, logo, 0.28);
  assert.equal(brandClip(timeline).transform.scale, 0.28, 'size applies');
  assert.equal(brandCorner(brandClip(timeline), logo, timeline.format), 'bottom-left', 'stays in its corner');
  timeline = moveBrand(timeline, logo, 'top-left');
  const clip = brandClip(timeline);
  assert.ok(clip.transform.x < 0.12 && clip.transform.y < 0.2, 'top left');
  assert.equal(brandCorner(clip, logo, timeline.format), 'top-left');
});

test('fadeBrand sets opacity; removeBrand takes the layer off', () => {
  const timeline = fadeBrand(applyBrand(withVideo([video('a')]), logo, 'top-right', 0.18, 'logo1'), 0.5);
  assert.equal(brandClip(timeline).transform.opacity, 0.5);
  const gone = removeBrand(timeline);
  assert.equal(gone.layers.some((entry) => entry.id === BRAND_LAYER_ID), false);
  assert.equal(removeBrand(gone), gone, 'removing twice changes nothing');
});

test('clip-level logos last exactly that clip and are listed and removable', () => {
  let timeline = withVideo([video('a'), video('b')]);
  const clip = timeline.layers[0].items[1]; // second clip, starts at 10
  timeline = brandOnClip(timeline, clip, logo, 'bottom-right', 0.18, 'mark1');
  const marks = brandsOnClip(timeline, clip);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].id, 'mark1');
  assert.equal(marks[0].start, clip.start);
  assert.equal(marks[0].out - marks[0].in, clip.out - clip.in, 'as long as the clip');
  assert.equal(brandsOnClip(timeline, timeline.layers[0].items[0]).length, 0, 'not on the other clip');
  // Covering the film must not stretch clip-level marks.
  const grown = coverBrand(insertClip(timeline, video('c')));
  const layer = grown.layers.find((entry) => entry.id === BRAND_CLIPS_LAYER_ID);
  assert.equal(layer.items[0].out - layer.items[0].in, clip.out - clip.in, 'clip logo keeps its length');
  const removed = removeClipBrand(grown, 'mark1');
  assert.equal(removed.layers.some((entry) => entry.id === BRAND_CLIPS_LAYER_ID), false, 'empty layer goes away');
});

test('clip-level and project logos coexist, project on top', () => {
  let timeline = withVideo([video('a')]);
  timeline = brandOnClip(timeline, timeline.layers[0].items[0], logo, 'top-right', 0.18, 'mark1');
  timeline = applyBrand(timeline, logo, 'top-right', 0.18, 'logo1');
  const ids = timeline.layers.map((entry) => entry.id);
  assert.ok(ids.indexOf(BRAND_LAYER_ID) > ids.indexOf(BRAND_CLIPS_LAYER_ID), 'project logo above clip logos');
});

test('coverBrand stretches the mark over a longer video without touching the recipe length', () => {
  const timeline = applyBrand(withVideo([video('a')]), logo, 'top-right', 0.18, 'logo1');
  const grown = insertClip(timeline, video('c'));
  assert.ok(brandClip(grown).out - brandClip(grown).in < duration(grown), 'saved brand is shorter than the grown film');
  const covered = coverBrand(grown);
  assert.equal(brandClip(covered).start, 0);
  assert.ok(brandClip(covered).out - brandClip(covered).in >= duration(grown), 'covers the whole film when played/exported');
  assert.equal(coverBrand(covered), covered, 'already covered: no change');
});
