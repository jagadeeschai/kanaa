import test from 'node:test';
import assert from 'node:assert/strict';
import { canReframe, reframeTransform } from '../src/timeline/reframe.ts';
import { clearPlace, facesOnScreen, keepCaptionsClear } from '../src/timeline/clear-faces.ts';
import { slotClip, buildStory, STORIES } from '../src/timeline/stories.ts';
import { valueAt } from '../src/timeline/evaluate.ts';
import { emptyTimeline, insertClip, mainLayer, newClip, setCaptions } from '../src/timeline/model.ts';

const portrait = { width: 1080, height: 1920, fps: 30 };
const landscape = { width: 1920, height: 1080 };
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-3, `${message}: ${a} vs ${b}`);
const video = (extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 20, ...landscape }, 'a'), ...extra });

test('reframe fills the frame and keeps the person in the middle', () => {
  assert.ok(canReframe(landscape, 0, portrait));
  assert.ok(!canReframe({ width: 1080, height: 1920 }, 0, portrait));
  const clip = video({ in: 2, out: 6 });
  const transform = reframeTransform(clip, [[2, 0.3, 0.5], [4, 0.5, 0.5], [6, 0.7, 0.5]], landscape, portrait);
  // A 16:9 picture fits a 9:16 frame at 1080 × 607.5; filling the height needs 1920 / 607.5.
  const fill = 1920 / 607.5;
  close(transform.scale, fill, 'fill scale');
  const shown = fill; // Its width as a share of the frame's: 1080 × fill / 1080.
  for (const [t, x] of [[0, 0.3], [2, 0.5], [4, 0.7]]) {
    const middle = valueAt(transform, 'x', t);
    close(middle + (x - 0.5) * shown, 0.5, `subject centred at ${t}s`);
  }
  // Never uncovers an edge, even for someone at the very side.
  const edge = reframeTransform(clip, [[2, 0.0, 0.5], [6, 1.0, 0.5]], landscape, portrait);
  for (const t of [0, 4]) { const x = valueAt(edge, 'x', t); assert.ok(x - shown / 2 <= 1e-6 && x + shown / 2 >= 1 - 1e-6, `covered at ${t}s`); }
  assert.equal(edge.keyframes.y, undefined, 'no vertical room in a portrait frame, so no y keys');
  assert.equal(reframeTransform(clip, [[10, 0.5, 0.5]], landscape, portrait), null, 'nobody in this stretch');
  assert.equal(reframeTransform(video({ adjust: { ...video().adjust, rotation: 90 } }), [[1, 0.5, 0.5]], landscape, portrait), null);
});

test('a reversed clip follows in the order it plays', () => {
  const clip = video({ in: 0, out: 4, reverse: true });
  const transform = reframeTransform(clip, [[0, 0.3, 0.5], [4, 0.7, 0.5]], landscape, portrait);
  assert.ok(valueAt(transform, 'x', 0) < valueAt(transform, 'x', 4), 'starts on the source end, where the subject is on the right');
});

test('captions move off faces, and only when they would cover one', () => {
  const layer = { position: 'bottom' };
  assert.equal(clearPlace(layer, []), null);
  assert.equal(clearPlace(layer, [{ top: 0.75, bottom: 0.9 }]), 'top');
  assert.equal(clearPlace(layer, [{ top: 0.75, bottom: 0.9 }, { top: 0.1, bottom: 0.2 }]), 'center');
  assert.equal(clearPlace(layer, [{ top: 0, bottom: 1 }]), null, 'nowhere clear: stay put');
  // A face low in a landscape clip filling a portrait frame.
  const clip = { ...video({ in: 0, out: 4 }), transform: { x: 0.5, y: 0.5, scale: 1920 / 607.5, opacity: 1, rotation: 0 } }; // Filling the frame.
  const faces = [[[0, 0.5, 0.85, 0.1, 0.2], [4, 0.5, 0.85, 0.1, 0.2]]];
  const boxes = facesOnScreen(clip, faces, landscape, portrait, 1);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0].bottom > 0.9, JSON.stringify(boxes));
  let t = insertClip(emptyTimeline(portrait), clip);
  t = setCaptions(t, [{ id: 'c1', start: 0, length: 2, words: [{ w: 'Hi', s: 0 }] }, { id: 'c2', start: 5, length: 1, words: [{ w: 'Later', s: 0 }] }], 'subs');
  const result = keepCaptionsClear(t, new Map([[clip.id, faces]]), () => landscape);
  assert.equal(result.moved, 1);
  const captions = result.timeline.layers.find((layer) => layer.kind === 'captions').items;
  assert.deepEqual(captions.map((caption) => caption.position ?? null), ['top', null]);
  assert.equal(keepCaptionsClear(result.timeline, new Map(), () => landscape).moved, 1, 'no faces any more: back in place');
});

test('stories use the best stretch when there is one, else the middle', () => {
  const slot = { label: 'x', tamil: 'x', seconds: 4, hint: '' };
  const source = { media_id: 1, media_type: 'video', duration: 20 };
  assert.deepEqual([slotClip(slot, source, 'a').in, slotClip(slot, source, 'a').out], [8, 12]);
  assert.deepEqual([slotClip(slot, source, 'a', 3).in, slotClip(slot, source, 'a', 3).out], [3, 7]);
  assert.equal(slotClip(slot, source, 'a', 19).in, 16, 'kept inside the clip');
  const story = STORIES[0];
  const fills = story.slots.map((_, index) => (index === 0 ? source : null));
  const built = buildStory(emptyTimeline(portrait), story, fills, () => 'n', [5]);
  assert.equal(mainLayer(built).items[0].in, 5);
});
