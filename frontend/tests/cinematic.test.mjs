import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCinematicPreset, applyCinematicPreset, clearCinematicPreset, CINEMATIC_PRESETS } from '../src/timeline/cinematic.ts';
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

test('widescreen bars are the frame, chosen on their own', () => {
  const applied = applyCinematicPreset(timelineWith([video('a')]), CINEMATIC_PRESETS[0]);
  assert.equal(activeCinematicPreset({ ...applied, finish: { ...applied.finish, letterbox: false } })?.id, CINEMATIC_PRESETS[0].id, 'bars off, still the preset');
  assert.deepEqual(clearCinematicPreset(applied).finish, { letterbox: true, grade: 0, glow: 0, vignette: 0, grain: 0 }, 'None keeps the bars');
  assert.equal(clearCinematicPreset({ ...applied, finish: { ...applied.finish, letterbox: false } }).finish, null);
});

test('a preset colours clips laid over the main track too, but not the brand watermark', async () => {
  const { brandLayer } = await import('../src/timeline/brand.ts');
  const base = timelineWith([video('a')]);
  const timeline = { ...base, layers: [...base.layers,
    { id: 'over', kind: 'video', name: 'Overlay', items: [{ ...video('o'), start: 6 }] },
    { id: 'brand', kind: 'video', name: 'Brand watermark', items: [{ ...video('logo') }] }] };
  const isBrand = (layer) => brandLayer({ ...timeline, layers: [layer] }) !== null;
  const applied = applyCinematicPreset(timeline, CINEMATIC_PRESETS.find((preset) => preset.id === 'mono-classic'));
  for (const layer of applied.layers) for (const clip of layer.items)
    assert.equal(clip.look ?? 'none', isBrand(layer) ? 'none' : 'mono', `${layer.id} ${clip.id}`);
  assert.equal(activeCinematicPreset(applied)?.id, 'mono-classic');
  const overlayInColour = { ...applied, layers: applied.layers.map((layer) => layer.id === 'over' ? { ...layer, items: layer.items.map((clip) => ({ ...clip, look: 'none' })) } : layer) };
  assert.equal(activeCinematicPreset(overlayInColour), null, 'an overlay in colour is not the preset');
  assert.ok(clearCinematicPreset(applied).layers.flatMap((layer) => layer.items).every((clip) => (clip.look ?? 'none') === 'none'));
});
