import test from 'node:test';
import assert from 'node:assert/strict';
import { applySky, cannotSky, removeSky } from '../src/timeline/sky.ts';
import { cannotLens } from '../src/timeline/lens.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = { id: 'a', media_id: 4, start: 0, in: 2, out: 5, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, transform: REST, adjust: {} };
const timeline = { version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', magnetic: true, items: [clip] }] };

test('the new sky copy plays in place of the part; changing keeps the first original; remove puts it back', () => {
  const sunset = applySky(timeline, 'a', 9, 'sunset');
  const on = sunset.layers[0].items[0];
  assert.deepEqual([on.media_id, on.in, on.out, on.new_sky.sky], [9, 0, 3, 'sunset']);
  const night = applySky(sunset, 'a', 11, 'night');
  assert.deepEqual([night.layers[0].items[0].new_sky.original_media_id, night.layers[0].items[0].new_sky.original_in], [4, 2]);
  assert.deepEqual(removeSky(night, 'a').layers[0].items[0], { ...clip, new_sky: null });
});

test('the new sky and the other made-copy looks ask for each other to come off first', () => {
  assert.equal(cannotSky(clip), null);
  assert.match(cannotSky({ ...clip, atmosphere: { original_media_id: 1, original_in: 0, original_out: 1, preset: 'mist' } }), /atmosphere/);
  assert.match(cannotLens({ ...clip, new_sky: { original_media_id: 1, original_in: 0, original_out: 1, sky: 'storm' } }), /new sky/);
});
