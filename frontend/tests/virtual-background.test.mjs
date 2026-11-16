import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withVirtualBackground } from '../src/timeline/virtual-background.ts';
import { matchGain } from '../src/timeline/composite.ts';

const clip = (id, start, out, extra = {}) => ({ id, media_id: 7, start, in: 0, out, speed: 1, volume: 1, muted: false, enabled: true, fade_in: 0, fade_out: 0, transform: { x: .5, y: .5, scale: 1, opacity: 1, rotation: 0 }, adjust: {}, ...extra });
const timeline = { format: { width: 1280, height: 720, fps: 30 }, layers: [{ id: 'main', kind: 'video', items: [clip('a', 0, 4), clip('talk', 4, 6, { transition_in: { kind: 'crossfade', duration: .5 } }), clip('c', 10, 12)] }, { id: 't', kind: 'text', items: [] }] };

test('a green-screen talk goes over a picture without moving anything', () => {
  const next = withVirtualBackground(timeline, 'talk', { media_id: 9, media_type: 'image' }, '#00b140', { layer: 'L', person: 'P' });
  const [main, presenter] = next.layers;
  assert.deepEqual(main.items.map((each) => [each.id, each.start, each.out]), [['a', 0, 4], ['talk', 4, 6], ['c', 10, 12]]);
  assert.equal(main.items[1].media_id, 9); assert.equal(main.items[1].muted, true); assert.equal(main.items[1].transition_in.kind, 'crossfade');
  assert.equal(presenter.id, 'L'); assert.equal(next.layers[2].id, 't');
  const person = presenter.items[0];
  assert.deepEqual([person.id, person.media_id, person.start, person.out, person.muted], ['P', 7, 4, 6, false]);
  assert.equal(person.chroma.color, '#00b140'); assert.equal(person.cutout ?? null, null); assert.equal(person.transition_in, null);
  assert.ok(person.composite.choke > 0 && person.composite.wrap > 0);
});

test('without a screen the person is cut out by the AI; a short background video slows to fit', () => {
  const next = withVirtualBackground(timeline, 'talk', { media_id: 9, media_type: 'video', duration: 3 }, null, { layer: 'L', person: 'P' });
  const behind = next.layers[0].items[1];
  assert.equal(behind.out, 3); assert.equal(behind.speed, .5);
  assert.equal(next.layers[1].items[0].cutout, 'remove'); assert.equal(next.layers[1].items[0].chroma, null);
});

test('colour match scales the measured gains by the amount', () => {
  assert.deepEqual(matchGain({ choke: 0, wrap: 0, match: .5, match_gain: [1.2, 1, .8] }).map((v) => Math.round(v * 1000) / 1000), [1.1, 1, .9]);
  assert.deepEqual(matchGain(null), [1, 1, 1]);
});
