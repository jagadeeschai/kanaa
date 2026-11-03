import test from 'node:test';
import assert from 'node:assert/strict';
import { blurForFace, videoAt, boxInSource, followPath, frameToSource, simplify, sourceToFrame, unfollow, videoUnder } from '../src/timeline/tracking.ts';
import { blurGrid } from '../src/timeline/blur.ts';
import { addBlur, addOverlay, normalizeTimeline, emptyTimeline, insertClip, newClip, trackLayers, trimText } from '../src/timeline/model.ts';
import { valueAt } from '../src/timeline/evaluate.ts';

const format = { width: 1080, height: 1920, fps: 30 };
const source = { width: 1920, height: 1080 };
const video = (id, extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, id), ...extra });
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);

test('source and frame positions convert both ways, turned, flipped, scaled and moved', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const flip of [false, true]) {
      const clip = video('a', { adjust: { rotation, flip_horizontal: flip, flip_vertical: false, brightness: 1, contrast: 1, saturation: 1 }, transform: { x: 0.4, y: 0.55, scale: 1.7, opacity: 1, rotation: 12 } });
      const [x, y] = sourceToFrame(clip, source, format, 0, 0.3, 0.6);
      const back = frameToSource(clip, source, format, 0, x, y);
      close(back[0], 0.3, `u at ${rotation} ${flip}`); close(back[1], 0.6, `v at ${rotation} ${flip}`);
    }
  }
});

test('a fitted clip shows its centre in the middle and its edges where the shader puts them', () => {
  const clip = video('a');
  assert.deepEqual(sourceToFrame(clip, source, format, 0, 0.5, 0.5), [0.5, 0.5]);
  // A wide clip fitted into a tall frame is letterboxed: its top edge is above the middle by half its fitted height.
  close(sourceToFrame(clip, source, format, 0, 0.5, 0)[1], 0.5 - (1080 * 1080 / 1920) / 2 / 1920, 'top');
  assert.equal(frameToSource(clip, source, format, 0, 0.5, 0.05), null);
});

test('simplify keeps a straight line as two points and keeps a corner', () => {
  const line = Array.from({ length: 30 }, (_, index) => [index / 30, index / 60]);
  assert.equal(simplify(line, 0.001).length, 2);
  const corner = Array.from({ length: 31 }, (_, index) => [index, index <= 15 ? index : 30 - index]);
  assert.deepEqual(simplify(corner, 0.1).map(([t]) => t), [0, 15, 30]);
});

test('following keeps the item where it was drawn, relative to the subject', () => {
  const under = video('under', { start: 0, in: 2 });
  const item = { start: 1, length: 3, transform: { x: 0.7, y: 0.3, scale: 0.4, opacity: 1, rotation: 0 } };
  // The subject moves right across the source, one tenth of it per second.
  const points = Array.from({ length: 91 }, (_, index) => { const seconds = 3 + index / 30; return [seconds, 0.2 + (seconds - 3) * 0.1, 0.5, 0.1, 0.1]; });
  const drawnAt = 1;
  const followed = followPath(item, under, source, format, points, { size: false, drawnAt });
  close(valueAt(followed, 'x', drawnAt), 0.7, 'x where drawn');
  close(valueAt(followed, 'y', drawnAt), 0.3, 'y where drawn');
  const fitted = 1080; // The source's fitted width in this frame.
  close(valueAt(followed, 'x', 2) - valueAt(followed, 'x', 1), (0.1 * fitted) / format.width, 'moves with the subject');
  assert.ok(followed.keyframes.x.length <= 3, 'a straight move needs only a few keys');
  assert.equal(followed.keyframes.scale, undefined);
});

test('following size scales with the subject, and continuing keeps earlier keys', () => {
  const under = video('under');
  const item = { start: 0, length: 4, transform: { x: 0.5, y: 0.5, scale: 0.5, opacity: 1, rotation: 0 } };
  const points = Array.from({ length: 61 }, (_, index) => [index / 30, 0.5, 0.5, 0.1 + index / 600, 0.1 + index / 600]);
  const sized = followPath(item, under, source, format, points, { size: true, drawnAt: 0 });
  close(valueAt(sized, 'scale', 2), 1, 'twice as big, twice the scale');
  const later = points.map(([t, , , w, h]) => [t + 2, 0.6, 0.5, w, h]);
  const continued = followPath({ ...item, transform: sized }, under, source, format, later, { size: false, drawnAt: 2, from: 2 });
  assert.ok(continued.keyframes.x.some((key) => key.t < 2), 'earlier keys stay');
  close(valueAt(continued, 'x', 2), valueAt(sized, 'x', 2), 'no jump where it continues');
  const still = unfollow(continued, 3);
  assert.equal(still.keyframes.x, undefined);
  close(still.x, valueAt(continued, 'x', 3), 'stays where it was');
});

test('a drawn box maps into the source, and items find the video under them', () => {
  let timeline = insertClip(emptyTimeline(format), video('main'));
  timeline = addOverlay(timeline, { ...newClip({ media_id: 2, media_type: 'image' }, 'logo'), start: 1 }, 'over');
  timeline = addBlur(timeline, { id: 'b', start: 0, length: 3, style: 'blur', shape: 'oval', amount: 0.6, width: 0.2, height: 0.2, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 } }, 'blurs');
  assert.equal(videoUnder(timeline, 'logo', 2, (id) => id === 1).id, 'main');
  assert.equal(videoUnder(timeline, 'b', 2, (id) => id === 1).id, 'main');
  assert.equal(videoUnder(timeline, 'main', 2, () => true), null);
  assert.deepEqual(trackLayers(timeline).map((layer) => layer.kind), ['blur', 'video']);
  const box = boxInSource(timeline.layers[0].items[0], source, format, 0, [0.5, 0.5, 0.2, 0.05]);
  close(box[0], 0.5, 'centre'); close(box[2], (0.2 * 1080) / 1080, 'width');
});

test('blur boxes trim like text, and their motion stays on the picture', () => {
  let timeline = insertClip(emptyTimeline(format), video('main'));
  timeline = addBlur(timeline, { id: 'b', start: 1, length: 3, style: 'blur', shape: 'oval', amount: 0.6, width: 0.2, height: 0.2, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, keyframes: { x: [{ t: 0, v: 0.2 }, { t: 2, v: 0.6 }] } } }, 'blurs');
  const trimmed = trimText(timeline, 'b', 'in', 2).layers.find((layer) => layer.kind === 'blur').items[0];
  assert.equal(trimmed.start, 2);
  close(valueAt(trimmed.transform, 'x', 0), 0.4, 'same position one second in');
});

test('pixel blocks are the same share of the frame at any size', () => {
  assert.deepEqual(blurGrid(0.5, { width: 1080, height: 1920 }), blurGrid(0.5, { width: 2160, height: 3840 }));
  assert.deepEqual(blurGrid(1, { width: 1920, height: 1080 }), [30, 17]);
});

test('a blur box saved with only some values gets the rest', () => {
  const loaded = normalizeTimeline({ version: 2, format, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [] }, { id: 'h', kind: 'blur', items: [{ id: 'b', start: 0, length: 1, transform: { x: 0.3 } }] }] });
  const blur = loaded.layers[1].items[0];
  assert.equal(blur.style, 'blur');
  assert.deepEqual([blur.transform.x, blur.transform.y, blur.transform.scale], [0.3, 0.5, 1]);
});

test('titles load with a resting transform, and trimming their start keeps their motion on time', () => {
  const loaded = normalizeTimeline({ version: 2, format, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [] }, { id: 't', kind: 'text', items: [{ id: 'x', start: 1, length: 3, text: 'Hi', style: 'band', position: 'bottom', color: '#ffffff', size: 40, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, keyframes: { x: [{ t: 0, v: 0.2 }, { t: 2, v: 0.6 }] } } }] }] });
  assert.equal(loaded.layers[1].items[0].transform.rotation, 0);
  const trimmed = trimText(loaded, 'x', 'in', 2).layers[1].items[0];
  close(valueAt(trimmed.transform, 'x', 0), 0.4, 'same position one second in');
  const plain = normalizeTimeline({ version: 2, format, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [] }, { id: 't', kind: 'text', items: [{ id: 'y', start: 0, length: 1, text: 'Hi', style: 'band', position: 'top', color: '#ffffff', size: 40 }] }] });
  assert.deepEqual(plain.layers[1].items[0].transform, { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 });
});

test('a found face becomes a blur box on the face, for the part of it inside the clip', () => {
  const under = video('main', { start: 2, in: 1, out: 4 });
  const path = Array.from({ length: 121 }, (_, index) => { const seconds = index / 30; return [seconds, 0.3 + seconds * 0.05, 0.5, 0.1, 0.2 + seconds * 0.02]; });
  const blur = blurForFace(path, under, source, format, 'f');
  close(blur.start, 2, 'starts where the clip shows second 1');
  assert.ok(Math.abs(blur.length - (3 + 1 / 30)) < 0.001, 'until the clip ends');
  const [x, y] = sourceToFrame(under, source, format, 1, 0.3 + 2 * 0.05, 0.5);
  close(valueAt(blur.transform, 'x', 1), x, 'on the face a second in');
  close(valueAt(blur.transform, 'y', 1), y, 'and at its height');
  assert.ok(valueAt(blur.transform, 'scale', 2.9) > 1.1, 'grows as the face does');
  assert.equal(blur.shape, 'oval');
  let timeline = insertClip(emptyTimeline(format), video('a'));
  assert.equal(videoAt(timeline, 1, () => true).id, 'a');
  assert.equal(videoAt(timeline, 1, () => false), null);
});
