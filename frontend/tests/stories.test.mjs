import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTimeline, insertClip, mainLayer, newClip, clipLength } from '../src/timeline/model.ts';
import { buildStory, fillRest, slotClip, STORIES, storySeconds } from '../src/timeline/stories.ts';
import { THEMES } from '../src/timeline/themes.ts';

const format = { width: 1080, height: 1920, fps: 30 };
const video = (id, seconds) => ({ media_id: id, media_type: 'video', duration: seconds });
const photo = (id) => ({ media_id: id, media_type: 'image' });
let counter = 0;
const newId = () => `id${counter++}`;

test('every story has a real theme and sensible moments', () => {
  for (const story of STORIES) {
    assert.ok(THEMES.some((theme) => theme.id === story.theme), story.id);
    assert.ok(story.slots.length >= 4 && story.slots.length <= 8, story.id);
    assert.ok(story.slots.every((slot) => slot.seconds >= 2 && slot.seconds <= 8 && slot.label && slot.tamil), story.id);
    assert.ok(storySeconds(story) >= 20 && storySeconds(story) <= 40, story.id);
  }
});

test('a long video keeps its middle, a short one plays whole, a photo lasts the moment', () => {
  const moment = { label: 'Cake', tamil: 'கேக்', seconds: 4, hint: '' };
  const long = slotClip(moment, video(1, 20), 'a');
  assert.deepEqual([long.in, long.out], [8, 12]);
  const short = slotClip(moment, video(2, 2.5), 'b');
  assert.deepEqual([short.in, short.out], [0, 2.5]);
  assert.equal(clipLength(slotClip(moment, photo(3), 'c')), 4);
});

test('a story replaces the main track in its order and skips empty moments', () => {
  const story = STORIES.find((item) => item.id === 'birthday');
  const before = insertClip(emptyTimeline(format), newClip(video(9, 30), 'old'));
  const fills = [video(1, 20), null, photo(2), video(3, 3), null, null];
  const built = buildStory(before, story, fills, newId);
  const clips = mainLayer(built).items;
  assert.deepEqual(clips.map((clip) => clip.media_id), [1, 2, 3]);
  assert.deepEqual(clips.map((clip) => clip.start), [0, 4, 9]);
  assert.equal(clips[1].out, 5);
  const wide = buildStory(before, story, [{ ...video(1, 20), width: 1920, height: 1080 }], newId);
  assert.ok(Math.abs(mainLayer(wide).items[0].transform.scale - (1920 / 1080) ** 2) < 1e-2, 'a landscape clip fills a vertical frame');
  const filled = fillRest(story, fills, [video(1, 20), photo(4), photo(5), video(6, 9)]);
  assert.deepEqual(filled.map((source) => source?.media_id ?? null), [1, 4, 2, 3, 5, 6]);
  assert.deepEqual(fillRest(story, [null, null, null, null, null, null], [photo(7)]).map((source) => source?.media_id ?? null), [7, null, null, null, null, null]);
});
