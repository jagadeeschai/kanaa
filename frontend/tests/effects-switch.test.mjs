import test from 'node:test';
import assert from 'node:assert/strict';
import { newClip } from '../src/timeline/model.ts';
import { applyBypass, clipEffects, playingTimeline, removeEffect, toggleAllEffects, toggleEffect } from '../src/timeline/effects.ts';
import { RAMPS } from '../src/timeline/ramp.ts';

const busy = () => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, 'c'), look: 'warm', old_film: { intensity: .65, grain: .55, scratches: .45, dust: .35, weave: .25 }, signal_damage: { mode: 'glitch', intensity: .6, rgb_split: .5, jitter: .45, scanlines: .35, noise: .3 }, cutout: 'blur', blur_amount: 'strong', ramp: RAMPS.hero, transition_in: { kind: 'whip', duration: 0.4 },
  transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0, keyframes: { x: [{ t: 0, v: 0.2 }, { t: 1, v: 0.8 }, { t: 2, v: 0.5 }] } } });

test('only the effects a clip has are listed, named plainly', () => {
  assert.deepEqual(clipEffects(newClip({ media_id: 1, media_type: 'video', duration: 5 }, 'p')), []);
  const list = clipEffects(busy());
  assert.deepEqual(list.map((effect) => effect.id), ['look', 'old_film', 'signal_damage', 'background', 'speed_effect', 'motion', 'transition']);
  assert.deepEqual(list.map((effect) => effect.detail), ['Warm', 'grain, scratches and weave', 'digital glitch', 'Strong blur', 'Hero', '3 points', 'Whip']);
  assert.ok(list.every((effect) => effect.on));
});

test('switching an effect off leaves it out of what plays and keeps its settings', () => {
  const clip = { ...busy(), ...toggleEffect(busy(), 'look') };
  assert.deepEqual(clip.bypass, ['look']);
  assert.equal(clip.look, 'warm');
  assert.equal(applyBypass(clip).look, 'none');
  assert.equal(clipEffects(clip).find((effect) => effect.id === 'look').on, false);
  const back = { ...clip, ...toggleEffect(clip, 'look') };
  assert.equal(back.bypass, null);
  const still = applyBypass({ ...busy(), bypass: ['motion', 'background'] });
  assert.equal(still.transform.keyframes, undefined);
  assert.equal(still.cutout, null);
  assert.equal(applyBypass({ ...busy(), bypass: ['old_film'] }).old_film, null);
  assert.equal(applyBypass({ ...busy(), bypass: ['signal_damage'] }).signal_damage, null);
});

test('all off, all back on, remove for good, and the timeline as it plays', () => {
  const clip = busy();
  const allOff = { ...clip, ...toggleAllEffects(clip) };
  assert.equal(allOff.bypass.length, 7);
  assert.equal({ ...allOff, ...toggleAllEffects(allOff) }.bypass, null);
  const removed = { ...clip, bypass: ['transition'], ...removeEffect({ ...clip, bypass: ['transition'] }, 'transition') };
  assert.equal(removed.transition_in, null);
  assert.equal(removed.bypass, null);
  assert.equal(removed.look, 'warm');
  const timeline = { version: 2, format: { width: 1080, height: 1920, fps: 30 }, layers: [{ id: 'main', kind: 'video', items: [{ ...clip, bypass: ['look'] }] }] };
  assert.equal(playingTimeline(timeline).layers[0].items[0].look, 'none');
  assert.equal(timeline.layers[0].items[0].look, 'warm');
});
