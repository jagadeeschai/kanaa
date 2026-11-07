import test from 'node:test';
import assert from 'node:assert/strict';
import { applyClipDrop, decodePayload, encodePayload } from '../src/timeline/drop.ts';
import { emptyTimeline, insertClip, mainLayer, newClip } from '../src/timeline/model.ts';
import { applyBypass, clipEffects, removeEffect } from '../src/timeline/effects.ts';

const one = () => insertClip(emptyTimeline({ width: 1080, height: 1920, fps: 30 }), newClip({ media_id: 1, media_type: 'video', duration: 4 }, 'a'));

test('each picture-shaping preset drops onto a clip with its own settings', () => {
  const expect = {
    duotone: (clip) => clip.tone_grade.mode === 'duotone',
    'split-tone': (clip) => clip.tone_grade.mode === 'split',
    mirror: (clip) => clip.mirror.mode === 'left',
    kaleidoscope: (clip) => clip.mirror.mode === 'kaleido' && clip.mirror.segments === 6,
    'zoom-blur': (clip) => clip.zoom_blur.intensity === 0.5,
    'tilt-shift': (clip) => clip.tilt_shift.focus_y === 0.55,
    echo: (clip) => clip.echo.trails === 4,
  };
  for (const [effect, check] of Object.entries(expect)) {
    const payload = { kind: 'clip_effect', effect };
    assert.deepEqual(decodePayload(encodePayload(payload)), payload, effect);
    assert.ok(check(mainLayer(applyClipDrop(one(), payload, 'a')).items[0]), effect);
  }
});

test('the new effects are listed, switch off and remove like the others', () => {
  const clip = { ...newClip({ media_id: 1, media_type: 'video', duration: 4 }, 'c'),
    tone_grade: { mode: 'duotone', shadow: '#102040', highlight: '#f0d080', balance: 0.5, intensity: 1 }, mirror: { mode: 'kaleido', segments: 8, angle: 0 },
    zoom_blur: { intensity: 0.5, center_x: 0.5, center_y: 0.5 }, tilt_shift: { focus_y: 0.5, band: 0.2, blur: 0.6, saturation: 0.3 }, echo: { mode: 'smear', trails: 4, decay: 0.8 } };
  const list = clipEffects(clip);
  assert.deepEqual(list.map((effect) => effect.id), ['tone_grade', 'mirror', 'zoom_blur', 'tilt_shift', 'echo']);
  assert.deepEqual(list.map((effect) => effect.label), ['Duotone', 'Kaleidoscope', 'Zoom blur', 'Tilt-shift', 'Echo trail']);
  for (const id of ['tone_grade', 'mirror', 'zoom_blur', 'tilt_shift', 'echo']) {
    assert.equal(applyBypass({ ...clip, bypass: [id] })[id], null, id);
    assert.equal(removeEffect(clip, id)[id], null, id);
  }
});
