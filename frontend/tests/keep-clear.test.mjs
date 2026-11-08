import test from 'node:test';
import assert from 'node:assert/strict';
import { baseTransform, clearShift, keepClear, removeKeepClear, smoothShifts, titleRect, unpackGrid } from '../src/timeline/keepClear.ts';
import { valueAt } from '../src/timeline/evaluate.ts';

const format = { width: 1280, height: 720, fps: 30 };
const clip = { id: 'c', media_id: 1, start: 0, in: 0, out: 6, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0,
  transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, adjust: { rotation: 0, flip_horizontal: false, flip_vertical: false } };
const text = (extra = {}) => ({ id: 't', start: 0, length: 6, text: 'The journey', style: 'outline', position: 'center', color: '#ffffff', size: 60,
  transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, ...extra });
// The letters: a wide band across the middle of the picture.
const box = [0.2, 0.45, 0.8, 0.55];

/** A grid where a person (a column 10 cells wide, the lower two thirds of the frame) walks left to right. */
function walkingGrid(seconds = 6, fps = 12, w = 48, h = 27) {
  const frames = [];
  for (let k = 0; k <= seconds * fps; k += 1) {
    const centre = Math.round((k / (seconds * fps)) * (w + 20)) - 10;
    const bits = new Uint8Array(Math.ceil((w * h) / 8));
    for (let j = Math.floor(h / 3); j < h; j += 1) for (let i = centre - 5; i < centre + 5; i += 1) {
      if (i < 0 || i >= w) continue;
      const index = j * w + i;
      bits[index >> 3] |= 1 << (7 - (index & 7));
    }
    frames.push(btoa(String.fromCharCode(...bits)));
  }
  return { fps, start: 0, w, h, frames };
}

test('grids read the way the backend packs them', () => {
  // pack() of a 5x3 grid with cells (0,0), (2,1) and (4,2) on, from people_grid_service.py.
  assert.deepEqual([...unpackGrid('gQI=', 5, 3)].flatMap((on, index) => (on ? [index] : [])), [0, 7, 14]);
});

test('the smallest clearing move skips past everyone, and gives up past the limit', () => {
  const rect = [0.4, 0.4, 0.6, 0.6];
  const people = [{ x: 0.5, y: 0.55, rx: 0.01, ry: 0.01 }, { x: 0.5, y: 0.3, rx: 0.01, ry: 0.01 }];
  // Up: just past the first person (0.6 - 0.54 = 0.06); the title then fits in the space below the second one.
  assert.ok(Math.abs(clearShift(rect, people, 'up', 0, 0, 1) - 0.06) < 1e-3);
  assert.equal(clearShift(rect, people, 'up', 0, 0, 0.05), null);
  // With a gap the space between them is too tight, so it goes on past the second person (0.6 + 0.02 - 0.29).
  assert.ok(Math.abs(clearShift(rect, people, 'up', 0, 0.02, 1) - 0.33) < 1e-3);
  assert.ok(Math.abs(clearShift(rect, people, 'down', 0, 0, 1) - (0.56 - 0.4)) < 1e-3);
  assert.equal(clearShift(rect, [{ x: 0.9, y: 0.5, rx: 0.01, ry: 0.01 }], 'up', 0, 0, 1), 0);
});

test('smoothing never drops below what is needed and starts early', () => {
  const raw = [0, 0, 0, 0, 0.2, 0.2, 0, 0, 0, 0];
  const smooth = smoothShifts(raw, 2, 1);
  smooth.forEach((value, index) => assert.ok(value >= raw[index]));
  assert.ok(smooth[2] > 0, 'moves before the person arrives');
  assert.equal(smooth[9], 0);
});

test('a person walking through the title: it moves up, clears them, and comes back', () => {
  const result = keepClear({ text: text(), box, format, under: clip, source: { width: 1280, height: 720 }, grid: walkingGrid(),
    settings: { gap: 0.04, direction: 'auto', max_move: 0.4 } });
  assert.equal(result.direction, 'up', 'the person is low in the frame, so up is the short way out');
  assert.deepEqual(result.uncleared, []);
  const moved = { ...text(), transform: result.transform };
  const ys = [0, 1.5, 3, 4.5, 6].map((t) => valueAt(result.transform, 'y', t));
  assert.ok(ys[2] < 0.5 - 0.1, `up in the middle: ${ys[2]}`);
  assert.ok(Math.abs(ys[0] - 0.5) < 1e-3 && Math.abs(ys[4] - 0.5) < 1e-3, `back at the ends: ${ys}`);
  // As drawn, the letters stay above the person's head (a third of the way down) all through the middle.
  const rect = titleRect(moved, result.transform, box, format, 3, null);
  assert.ok(rect[3] <= 1 / 3 - 0.04 + 1e-3, `bottom of letters ${rect[3]}`);
  assert.equal(result.transform.keyframes.x, undefined);
});

test('a forced direction is followed, and redo and remove work from the original move', () => {
  const original = text({ transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0, keyframes: { x: [{ t: 0, v: 0.45, ease: 'linear' }, { t: 6, v: 0.55, ease: 'linear' }] } } });
  const job = { text: original, box, format, under: clip, source: { width: 1280, height: 720 }, grid: walkingGrid(), settings: { gap: 0.02, direction: 'down', max_move: 0.1 } };
  const first = keepClear(job);
  assert.equal(first.direction, 'down');
  assert.ok(first.uncleared.length > 0, 'the person fills the bottom, so down cannot clear within 10%');
  const kept = { ...original, transform: first.transform, keep_clear: first.keep_clear };
  // The x keys of the original stay; redoing starts from them, not from the moved title.
  assert.deepEqual(first.transform.keyframes.x, original.transform.keyframes.x);
  assert.deepEqual(baseTransform(kept), original.transform);
  const again = keepClear({ ...job, text: kept, settings: { gap: 0.04, direction: 'up', max_move: 0.4 } });
  assert.deepEqual(again.keep_clear.x_keys, original.transform.keyframes.x);
  assert.deepEqual(removeKeepClear({ ...kept, transform: again.transform, keep_clear: again.keep_clear }), { transform: original.transform, keep_clear: null });
});

test('"Aside" picks whichever side is shorter', () => {
  const result = keepClear({ text: text(), box, format, under: clip, source: { width: 1280, height: 720 }, grid: walkingGrid(),
    settings: { gap: 0.02, direction: 'side', max_move: 0.5 } });
  assert.ok(result.direction === 'left' || result.direction === 'right');
});
