import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { compareStates, dividerFor, splitAt } from '../src/timeline/compare.ts';
import { graphicState } from '../src/timeline/graphics.ts';

const item = { id: 'split', start: 2, length: 4, text: 'Before / after', style: 'plain', position: 'center', color: '#ffffff', size: 44,
  graphic: { kind: 'compare-divider', style: 'clean', from: [.5, .5], to: [.5, .5], width: 1, height: 1, line_width: .004, compare_clip: 'after', split_from: .9, split_to: .35, split_delay: .4, split_move: 4.5 } };

test('the preview steps and places the divider exactly as the export', () => {
  for (const fps of [24, 30]) {
    const samples = Array.from({ length: 160 }, (_, n) => n / 31);
    const backend = JSON.parse(execFileSync('../backend/.venv/bin/python', ['-c', 'import json,sys; from app.services.timeline_schema import Text; from app.services.explainer_graphics import state_at; from app.services.compare_graphics import compare_states, split_at; d=json.load(sys.stdin); i=Text.model_validate(d["item"]); f=d["fps"]; print(json.dumps({"times":compare_states(i,f),"states":[state_at(i,t,f) for t in d["samples"]],"split":[split_at(i.graphic,t,f) for t in d["samples"]]}))'],
      { cwd: process.cwd(), env: { ...process.env, PYTHONPATH: '../backend' }, input: JSON.stringify({ item, samples, fps }), encoding: 'utf8' }));
    assert.deepEqual(compareStates(item, fps), backend.times);
    assert.deepEqual(samples.map((at) => graphicState(item, at, fps)), backend.states);
    samples.forEach((at, n) => assert.ok(Math.abs(splitAt(item.graphic, at, fps) - backend.split[n]) < 1e-9, `${fps} fps at ${at}`));
  }
});

test('a clip finds the divider that reveals it', () => {
  const timeline = { format: { width: 1280, height: 720, fps: 30 }, layers: [{ id: 'main', kind: 'video', items: [] }, { id: 'g', kind: 'text', items: [item] }] };
  assert.equal(dividerFor(timeline, 'after')?.id, 'split');
  assert.equal(dividerFor(timeline, 'other'), undefined);
  assert.equal(dividerFor({ ...timeline, layers: [{ ...timeline.layers[1], hidden: true }] }, 'after'), undefined);
});
