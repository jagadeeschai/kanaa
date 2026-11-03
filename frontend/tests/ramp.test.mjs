import test from 'node:test';
import assert from 'node:assert/strict';
import { localAt, RAMPS, rampShare, rampTime, sourceAt, splitRamp } from '../src/timeline/ramp.ts';
import { clipLength, emptyTimeline, freezeFrame, insertClip, mainLayer, newClip, splitClip, trimAtPlayhead } from '../src/timeline/model.ts';

const close = (a, b, message, within = 1e-6) => assert.ok(Math.abs(a - b) < within, `${message}: ${a} vs ${b}`);
const format = { width: 1080, height: 1920, fps: 30 };
const video = (id, extra = {}) => ({ ...newClip({ media_id: 1, media_type: 'video', duration: 10 }, id), ...extra });
const SAMPLES = [-0.1, 0.2, 0.4, 0.5, 0.65, 0.9, 1.1];

test('the browser and the server give every ramp the same shape', () => {
  // From ramp_share in backend/app/services/ramp.py.
  const server = { hero: [-0.125490196, 0.250980392, 0.489215686, 0.525490196, 0.573529412, 0.874509804, 1.125490196], 'speed-up': [-0.026666667, 0.078222222, 0.206222222, 0.288888889, 0.446222222, 0.815111111, 1.195555556] };
  for (const [name, values] of Object.entries(server)) SAMPLES.forEach((u, index) => close(rampShare(RAMPS[name], u), values[index], `${name} at ${u}`, 1e-8));
});

test('every preset plays the whole source in the clip time, and time is its exact inverse', () => {
  for (const [name, ramp] of Object.entries(RAMPS)) {
    close(rampShare(ramp, 0), 0, `${name} starts`); close(rampShare(ramp, 1), 1, `${name} ends`);
    for (const u of SAMPLES) close(rampTime(ramp, rampShare(ramp, u)), u, `${name} inverse at ${u}`, 1e-9);
  }
});

test('source and clip time convert both ways with a ramp, reversed or not', () => {
  for (const reverse of [false, true]) {
    const clip = video('a', { in: 1, out: 5, speed: 2, ramp: RAMPS.hero, reverse });
    for (const local of [0, 0.3, 1, 1.7]) close(localAt(clip, sourceAt(clip, local)), local, `reverse ${reverse} at ${local}`, 1e-9);
  }
  close(sourceAt(video('b', { in: 1, out: 5 }), 1), 2, 'no ramp plays straight');
});

test('splitting a ramped clip keeps every moment where it was', () => {
  const clip = video('a', { in: 1, out: 5, ramp: RAMPS.bullet });
  const timeline = insertClip(emptyTimeline(format), clip);
  const [first, second] = mainLayer(splitClip(timeline, 1.7, 'b')).items;
  close(clipLength(first), 1.7, 'first half length', 1e-3); close(clipLength(second), 4 - 1.7, 'second half length', 1e-3);
  for (const t of [0.4, 1.2, 2.5, 3.6]) {
    const half = t < 1.7 ? first : second;
    close(sourceAt(half, t - half.start), sourceAt(clip, t), `same source at ${t}`, 2e-3);
  }
  const [early] = splitRamp(RAMPS.bullet, 0.5);
  assert.equal(early.at(-1).t, 1);
});

test('I and O on a ramped clip cut at the playhead without moving the rest', () => {
  const clip = video('a', { in: 1, out: 5, ramp: RAMPS.hero });
  const timeline = insertClip(emptyTimeline(format), clip);
  const ids = ['x'];
  const trimmed = mainLayer(trimAtPlayhead(timeline, clip, 'in', 1.5, () => ids.shift())).items;
  assert.equal(trimmed.length, 1);
  close(sourceAt(trimmed[0], 0), sourceAt(clip, 1.5), 'starts at the playhead frame', 2e-3);
  const frozen = mainLayer(freezeFrame(timeline, 2, ['f', 'g'])).items.find((item) => item.id === 'f');
  close(frozen.freeze, sourceAt(clip, 2), 'freeze holds the ramped frame', 1e-3);
});
