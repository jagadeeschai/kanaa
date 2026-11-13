import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTitleMove, stillTitle, CRAWL_TILT, DRIFT_GROW, DRIFT_REACH, TITLE_MOVES } from '../src/timeline/titleMoves.ts';
import { valueAt } from '../src/timeline/evaluate.ts';
import { animatedLook, pictureLook, PICTURE_REST } from '../src/timeline/animation.ts';
import { is3d } from '../src/timeline/title3d.ts';

const title = (extra = {}) => ({ id: 't', start: 2, length: 4, text: 'Happy Pongal', style: 'outline', position: 'center', color: '#ffd400', size: 50,
  transform: { x: 0.4, y: 0.6, scale: 1, opacity: 1, rotation: 0 }, ...extra });
const moved = (move, text = title()) => ({ ...text, ...applyTitleMove(text, move) });

test('drifts move gently over the whole title, from where it is', () => {
  const drift = moved('drift');
  assert.equal(valueAt(drift.transform, 'scale', 0), 1);
  assert.ok(Math.abs(valueAt(drift.transform, 'scale', 4) - DRIFT_GROW) < 1e-4);
  const sideways = moved('drift-sideways');
  assert.ok(Math.abs(valueAt(sideways.transform, 'x', 2) - 0.4) < 1e-4, 'still at its place halfway');
  assert.ok(Math.abs(valueAt(sideways.transform, 'x', 4) - (0.4 + DRIFT_REACH)) < 1e-4);
  const up = moved('drift-up');
  assert.ok(valueAt(up.transform, 'y', 4) < valueAt(up.transform, 'y', 0), 'rises');
});

test('a ticker and credits start and end out of sight, with no animation fighting them', () => {
  const ticker = moved('ticker', title({ enter: { preset: 'fade', duration: 0.5 } }));
  assert.equal(valueAt(ticker.transform, 'x', 0), 1.5);
  assert.equal(valueAt(ticker.transform, 'x', 4), -0.5);
  assert.equal(ticker.position, 'bottom');
  assert.equal(ticker.enter, null);
  const credits = moved('credits');
  assert.equal(valueAt(credits.transform, 'y', 0), 1.5);
  assert.equal(valueAt(credits.transform, 'y', 4), -0.5);
});

test('a story crawl leans back and rolls away, through the 3D path', () => {
  const crawl = moved('crawl');
  assert.equal(crawl.transform.tilt_x, CRAWL_TILT);
  assert.ok(valueAt(crawl.transform, 'scale', 4) < valueAt(crawl.transform, 'scale', 0));
  assert.ok(is3d(crawl));
});

test('stand still keeps the title where it is now, and undoes a crawl\'s lean', () => {
  const crawl = moved('crawl');
  const still = { ...crawl, ...stillTitle(crawl, 2) };
  assert.deepEqual(Object.keys(still.transform.keyframes ?? {}), []);
  assert.ok(Math.abs(still.transform.y - valueAt(crawl.transform, 'y', 2)) < 1e-4);
  assert.equal(still.transform.tilt_x, 0);
  assert.ok(!is3d(still));
});

test('every move is offered once', () => {
  assert.equal(new Set(TITLE_MOVES.map((move) => move.id)).size, TITLE_MOVES.length);
  assert.equal(TITLE_MOVES.length, 11);
});

test('picture animations go through the 3D path, and enter and exit tricks combine', () => {
  for (const preset of ['reveal', 'soft-edge', 'line', 'chromatic', 'prism', 'echo']) assert.ok(is3d(title({ enter: { preset, duration: 1 } })), preset);
  assert.deepEqual(pictureLook({}, {}), PICTURE_REST);
  const both = animatedLook({ preset: 'reveal', duration: 1 }, { preset: 'line', duration: 1 }, 0.5, 4);
  assert.ok(both.reveal > 0.8 && both.reveal < 1, 'half way into the reveal');
  assert.equal(both.line, 1, 'the exit\'s line, drawn while at rest');
  const copies = animatedLook({ preset: 'chromatic', duration: 1 }, { preset: 'echo', duration: 1 }, 3.9, 4);
  assert.equal(copies.trick, 3, 'the wider copies, the echo leaving, win');
});

test('keep-alive moves repeat for the whole title and start from where it rests', async () => {
  const { applyTitleMove } = await import('../src/timeline/titleMoves.ts');
  const text = { id: 't', start: 0, length: 30, text: 'கற்கண்டு', style: 'shadow', position: 'bottom', color: '#fff', size: 40, transform: { x: 0.4, y: 0.6, scale: 1, opacity: 1, rotation: 0 } };
  const sway = applyTitleMove(text, 'sway').transform.keyframes.rotation;
  assert.ok(sway.length >= 15 && sway.every((key) => Math.abs(key.v) <= 3));
  assert.equal(sway.at(-1).t, 30);
  const float = applyTitleMove(text, 'float').transform.keyframes.y;
  assert.ok(float.every((key) => Math.abs(key.v - 0.6) <= 0.0101));
  const swing = applyTitleMove(text, 'swing-3d').transform.keyframes.tilt_y;
  assert.ok(swing.some((key) => key.v > 20) && swing.some((key) => key.v < -20));
  const turn = applyTitleMove(text, 'turn-now-and-then').transform.keyframes.rotation;
  assert.equal(turn.at(-1).v, 360 * 4, 'one turn every six seconds, ending still');
  assert.ok(turn.every((key, n) => n === 0 || key.t > turn[n - 1].t));
});
