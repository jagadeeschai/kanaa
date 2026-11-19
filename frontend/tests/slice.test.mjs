import test from 'node:test';
import assert from 'node:assert/strict';
import { cannotSlice, sliceIntoPieces, SLICES } from '../src/timeline/slice.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const clip = (id, start, length, extra = {}) => ({ id, media_id: 1, start, in: 0, out: length, speed: 1, volume: 0, muted: true, fade_in: 0, fade_out: 0, transform: REST, adjust: {}, ...extra });
const video = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [{ id: 'main', kind: 'video', name: 'Main', magnetic: true, items: [clip('a', 0, 4), clip('b', 4, 3)] }] });
let n = 0; const id = () => `id${n++}`;

test('each style cuts the picture into strips that cover it, held on its last moment over the next clip', () => {
  for (const style of SLICES) {
    const sliced = sliceIntoPieces(video(), 'a', style.id, { media_id: 1, media_type: 'video' }, id);
    const pieces = sliced.layers.slice(1, 1 + style.pieces).map((layer) => layer.items[0]);
    assert.equal(pieces.length, style.pieces, style.id);
    const along = style.strips === 'rows' ? ['y0', 'y1'] : ['x0', 'x1'];
    assert.equal(pieces[0].crop[along[0]], 0); assert.equal(pieces.at(-1).crop[along[1]], 1);
    pieces.slice(1).forEach((piece, i) => assert.equal(piece.crop[along[0]], pieces[i].crop[along[1]], 'strips meet with no gap'));
    for (const piece of pieces) {
      assert.equal(piece.start, 4, 'from the cut');
      assert.ok(Math.abs(piece.freeze - (4 - 1 / 30)) < 1e-3, 'the last frame held');
      assert.ok(Math.abs(piece.out - piece.in - 0.8) < 1e-6);
      assert.equal(piece.transform.keyframes.x[0].v, 0.5, 'starts where the picture is');
    }
    const ends = pieces.map((piece) => [piece.transform.keyframes.x.at(-1).v - 0.5, piece.transform.keyframes.y.at(-1).v - 0.5]);
    const moving = style.strips === 'rows' ? 0 : 1;
    assert.ok(ends[0][moving] * ends[1][moving] < 0, `${style.id}: neighbours go opposite ways`);
    assert.ok(Math.abs(ends[0][moving]) > 1, 'right off the frame');
  }
});

test('a picture is used whole, and slicing is refused when it cannot work', () => {
  const sliced = sliceIntoPieces(video(), 'a', 'sideways', { media_id: 1, media_type: 'image' }, id);
  assert.equal(sliced.layers[1].items[0].freeze, null);
  assert.match(cannotSlice(video(), 'b', 'four'), /another clip after it/);
  const full = video();
  for (let i = 0; i < 5; i += 1) full.layers.push({ id: `o${i}`, kind: 'video', items: [] });
  assert.match(cannotSlice(full, 'a', 'four'), /4 more video layers/);
  assert.equal(cannotSlice(full, 'a', 'sideways'), null);
});
