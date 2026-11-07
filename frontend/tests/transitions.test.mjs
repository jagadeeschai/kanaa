import test from 'node:test';
import assert from 'node:assert/strict';
import { clearTransitions, transitionEverywhere } from '../src/timeline/transitions.ts';
import { emptyTimeline, insertClip, mainLayer, newClip } from '../src/timeline/model.ts';

const format = { width: 1920, height: 1080, fps: 30 };
const video = (id, extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, id), ...extra });
const withVideos = (ids) => ids.reduce((timeline, id) => insertClip(timeline, video(id)), emptyTimeline(format));

test('transitionEverywhere puts one transition on every cut, not the first clip', () => {
  const timeline = transitionEverywhere(withVideos(['a', 'b', 'c']), 'wipe', 0.8);
  const items = mainLayer(timeline).items;
  assert.ok(!items[0].transition_in, 'the first clip has nothing to blend from');
  assert.deepEqual(items[1].transition_in, { kind: 'wipe', duration: 0.8 });
  assert.deepEqual(items[2].transition_in, { kind: 'wipe', duration: 0.8 });
});

test('overlay clips are untouched, and clearTransitions removes them all', () => {
  let timeline = withVideos(['a', 'b']);
  timeline = { ...timeline, layers: [...timeline.layers, { id: 'over', kind: 'video', name: 'Overlay', items: [{ ...video('o'), start: 0 }] }] };
  const placed = transitionEverywhere(timeline, 'zoom', 0.6);
  assert.ok(!placed.layers[1].items[0].transition_in, 'overlays keep their own enter animations');
  const cleared = clearTransitions(placed);
  assert.ok(mainLayer(cleared).items.every((clip) => !clip.transition_in));
});
