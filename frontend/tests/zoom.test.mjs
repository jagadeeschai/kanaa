import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomBy, wheelFactor, ZOOM_MAX } from '../src/timeline/zoom.ts';

test('zooming by hand grows or shrinks the picture, within bounds, keyframes kept', () => {
  const still = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
  assert.equal(zoomBy(still, 0, 1.5).scale, 1.5);
  assert.equal(zoomBy(still, 0, 100).scale, ZOOM_MAX);
  assert.ok(wheelFactor(-10, true) > 1 && wheelFactor(10, true) < 1, 'pinch out zooms in');
  const moving = { ...still, keyframes: { scale: [{ t: 0, v: 1, ease: 'linear' }, { t: 4, v: 1.2, ease: 'linear' }] } };
  const zoomed = zoomBy(moving, 2, 2);
  assert.equal(zoomed.keyframes.scale.length, 3, 'a key at the playhead, the move kept');
});
