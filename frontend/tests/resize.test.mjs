import test from 'node:test';
import assert from 'node:assert/strict';
import { newClip } from '../src/timeline/model.ts';
import { boxCorners, clipBox, resizeTo, MIN_SIZE } from '../src/timeline/resize.ts';

const format = { width: 1920, height: 1080, fps: 30 };
const frame = { width: 1920, height: 1080 };
const source = { width: 1920, height: 1080 };
const clip = (transform) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, 'c'), transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0, ...transform } });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('the box is the fitted clip times its size', () => {
  const box = clipBox(clip({ scale: 0.5, x: 0.25 }), { width: 1080, height: 1920 }, format, 0);
  near(box.height, 0.5); near(box.width, (1080 * (1080 / 1920) * 0.5) / 1920); near(box.x, 0.25);
});

test('dragging the bottom-right corner keeps the top-left corner still', () => {
  const start = clipBox(clip({ scale: 0.5 }), source, format, 0);
  // Top-left sits at 480,270; drag bottom-right from 1440,810 to 960,540 makes it a quarter of the frame.
  const next = resizeTo(start, [1, 1], { x: 960, y: 540 }, frame, false);
  near(next.scale, 0.25); near(next.x - 0.125, 0.25); near(next.y - 0.125, 0.25);
});

test('dragging the top-left corner keeps the bottom-right corner still', () => {
  const start = clipBox(clip({ scale: 0.5 }), source, format, 0);
  const next = resizeTo(start, [-1, -1], { x: 0, y: 0 }, frame, false);
  near(next.scale, 0.75); near(next.x, 0.375); near(next.y, 0.375);
});

test('with Option held the middle stays still', () => {
  const start = clipBox(clip({ scale: 0.5, x: 0.3, y: 0.6 }), source, format, 0);
  const next = resizeTo(start, [1, -1], { x: 0.3 * 1920 + 960, y: 0.6 * 1080 - 540 }, frame, true);
  near(next.scale, 1); assert.equal(next.x, 0.3); assert.equal(next.y, 0.6);
});

test('a turned clip keeps its opposite corner still too', () => {
  const start = clipBox(clip({ scale: 0.5, rotation: 90 }), source, format, 0);
  const corner = (box, sx, sy) => { const a = (box.turn * Math.PI) / 180; const hx = sx * box.width * 960; const hy = sy * box.height * 540;
    return { x: box.x * 1920 + hx * Math.cos(a) - hy * Math.sin(a), y: box.y * 1080 + hx * Math.sin(a) + hy * Math.cos(a) }; };
  const fixed = corner(start, -1, -1);
  const grabbed = corner(start, 1, 1);
  // Drag the grabbed corner 40% of the way to the fixed one: the clip ends at 60% of its size.
  const to = { x: grabbed.x + (fixed.x - grabbed.x) * 0.4, y: grabbed.y + (fixed.y - grabbed.y) * 0.4 };
  const next = resizeTo(start, [1, 1], to, frame, false);
  near(next.scale, 0.3);
  const after = corner({ ...start, x: next.x, y: next.y, width: start.width * 0.6, height: start.height * 0.6 }, -1, -1);
  near(after.x, fixed.x); near(after.y, fixed.y);
});

test('the size never collapses past the smallest', () => {
  const start = clipBox(clip({ scale: 0.5 }), source, format, 0);
  assert.equal(resizeTo(start, [1, 1], { x: 0, y: 0 }, frame, false).scale, MIN_SIZE);
});

test('the corners turn with the clip', () => {
  const box = clipBox(clip({ scale: 0.5, rotation: 180 }), source, format, 0);
  const [topLeft, , , bottomRight] = boxCorners(box, format);
  near(topLeft.x, 0.75); near(topLeft.y, 0.75); near(bottomRight.x, 0.25); near(bottomRight.y, 0.25);
});
