import test from 'node:test';
import assert from 'node:assert/strict';
import { clipBox, resizeFree, stretchToFrame } from '../src/timeline/resize.ts';

const format = { width: 1920, height: 1080, fps: 30 };
const frame = { width: 960, height: 540 };
const source = { width: 1080, height: 1920 };  // An upright phone picture in a wide frame.
const clip = (extra = {}) => ({ id: 'c', media_id: 1, start: 0, in: 0, out: 5, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, adjust: { rotation: 0 }, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, ...extra });

test('Stretch makes an upright picture fill a wide frame exactly', () => {
  const stretch = stretchToFrame(source, 0, format);
  const box = clipBox(clip({ stretch }), source, format, 0);
  assert.ok(Math.abs(box.width - 1) < 1e-9 && Math.abs(box.height - 1) < 1e-9);
});

test('a free corner drag sets width and height apart, the opposite corner staying put', () => {
  const start = clipBox(clip(), source, format, 0);  // Fitted: full height, narrow.
  const fixed = { x: (start.x - start.width / 2) * frame.width, y: (start.y - start.height / 2) * frame.height };  // Top left stays.
  const to = { x: fixed.x + 600, y: fixed.y + 300 };  // Drag the bottom right corner.
  const made = resizeFree(start, [1, 1], to, frame, false, source, 0, format);
  const after = clipBox(clip({ stretch: made.stretch, transform: { x: made.x, y: made.y, scale: made.scale, opacity: 1, rotation: 0 } }), source, format, 0);
  assert.ok(Math.abs(after.width * frame.width - 600) < 0.5, `width ${after.width * frame.width}`);
  assert.ok(Math.abs(after.height * frame.height - 300) < 0.5, `height ${after.height * frame.height}`);
  assert.ok(Math.abs((after.x - after.width / 2) * frame.width - fixed.x) < 0.5 && Math.abs((after.y - after.height / 2) * frame.height - fixed.y) < 0.5);
});
