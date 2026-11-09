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

test('the popover groups hold every transition the export knows, each once', async () => {
  const { TRANSITION_GROUPS } = await import('../src/timeline/transitions.ts');
  const { readFileSync } = await import('node:fs');
  const schema = readFileSync(new URL('../../backend/app/services/timeline_schema.py', import.meta.url), 'utf8');
  const literal = schema.match(/kind: Literal\[('crossfade'[^\]]*)\]/)[1];
  const known = [...literal.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]).sort();
  const grouped = TRANSITION_GROUPS.flatMap((group) => group.kinds);
  assert.equal(new Set(grouped).size, grouped.length, 'no kind twice');
  assert.deepEqual([...grouped].sort(), known);
});

test('cube and swap cards start and end flat on the frame', async () => {
  const { cardCorners } = await import('../src/timeline/animation.ts');
  const frame = [[0, 0], [1280, 0], [0, 720], [1280, 720]];
  const near = (corners) => corners.every(([x, y], index) => Math.abs(x - frame[index][0]) < 1e-6 && Math.abs(y - frame[index][1]) < 1e-6);
  assert.ok(near(cardCorners('cube', 'a', 0, 1280, 720)), 'the cube starts on the old clip');
  assert.ok(near(cardCorners('cube', 'b', 1, 1280, 720)), 'and ends on the new');
  assert.ok(near(cardCorners('swap', 'a', 0, 1280, 720)) && near(cardCorners('swap', 'b', 1, 1280, 720)));
  const [left, right] = [cardCorners('cube', 'a', 0.5, 1280, 720), cardCorners('cube', 'b', 0.5, 1280, 720)];
  assert.ok(left[1][0] <= 640 + 1e-6 && right[0][0] >= 640 - 1e-6, 'halfway the old face is on the left, the new on the right');
});
