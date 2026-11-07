import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCinematicPreset, applyCinematicPreset, CINEMATIC_PRESETS } from '../src/timeline/cinematic.ts';
import { emptyTimeline, insertClip, newClip } from '../src/timeline/model.ts';

const format = { width: 1920, height: 1080, fps: 30 };
const video = (id, extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, id), ...extra });

const timelineWith = (clips) => clips.reduce((timeline, clip) => insertClip(timeline, clip), emptyTimeline(format));

test('every preset applies its finish, look and no LUT', () => {
  for (const preset of CINEMATIC_PRESETS) {
    const timeline = applyCinematicPreset(timelineWith([video('a'), video('b', { look: 'vivid' })]), preset);
    assert.deepEqual(timeline.finish, preset.finish, `${preset.id} finish`);
    assert.equal(timeline.lut, null, `${preset.id} clears the LUT`);
    assert.ok(timeline.layers[0].items.every((clip) => clip.look === preset.look), `${preset.id} look on every clip`);
    assert.equal(activeCinematicPreset(timeline)?.id, preset.id, `${preset.id} recognised as active`);
  }
});

test('a preset is one change and leaves other layers alone', () => {
  const timeline = timelineWith([video('a')]);
  const applied = applyCinematicPreset({ ...timeline, layers: [...timeline.layers, { id: 't1', kind: 'text', items: [] }] }, CINEMATIC_PRESETS[0]);
  assert.equal(applied.layers.length, 2);
  assert.equal(applied.layers[1].id, 't1');
});

test('mixed or adjusted looks are not a preset', () => {
  const mixed = timelineWith([video('a', { look: 'warm' }), video('b', { look: 'cool' })]);
  assert.equal(activeCinematicPreset(mixed), null);
  const adjusted = applyCinematicPreset(timelineWith([video('a')]), CINEMATIC_PRESETS[0]);
  const ownFinish = { ...adjusted.finish, grain: 0.7 };
  assert.equal(activeCinematicPreset({ ...adjusted, finish: ownFinish }), null, 'a tweaked finish is custom, not the preset');
});
