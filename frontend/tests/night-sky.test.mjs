import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTimeline, insertClip, mainLayer, newClip } from '../src/timeline/model.ts';
import { NIGHT_SKY_LAYER, placeNightSky } from '../src/timeline/nightSky.ts';

test('the night sky lies just above the main track, with the picture\'s time and move', () => {
  let t = insertClip(emptyTimeline({ width: 1920, height: 1080, fps: 30 }), newClip({ media_id: 1, media_type: 'image', duration: 5, width: 1536, height: 1024 }, 'a'));
  t = insertClip(t, { ...newClip({ media_id: 2, media_type: 'image', duration: 5, width: 1536, height: 1024 }, 'b'), transform: { x: 0.4, y: 0.5, scale: 1.2, opacity: 1, rotation: 0, keyframes: { scale: [{ t: 0, v: 1.2, ease: 'linear' }, { t: 5, v: 1.3, ease: 'linear' }] } } });
  const clip = mainLayer(t).items[1];
  const next = placeNightSky(t, clip, { id: 9, duration: 5, width: 1280, height: 852 }, { clip: 's', layer: 'L' });
  const layer = next.layers[1];
  assert.equal(layer.name, NIGHT_SKY_LAYER); assert.equal(layer.blend, 'screen');
  assert.equal(layer.items[0].start, clip.start);
  assert.deepEqual(layer.items[0].transform, clip.transform);
});
