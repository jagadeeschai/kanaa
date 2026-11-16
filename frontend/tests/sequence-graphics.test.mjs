import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseSteps, parsePoints, stepStates, timelineStates } from '../src/timeline/sequence-graphics.ts';
import { graphicState } from '../src/timeline/graphics.ts';

test('steps strip optional numbering and bullets and validate counts', () => {
  assert.deepEqual(parseSteps('1. திட்டம்\n• உருவாக்கம்\n3) பகிர்வு').steps, ['திட்டம்', 'உருவாக்கம்', 'பகிர்வு']);
  assert.ok(parseSteps('one').error);
  assert.ok(parseSteps(Array(9).fill('one').join('\n')).error);
});

test('timeline points preserve free dates, optional labels and order', () => {
  assert.deepEqual(parsePoints('சங்க காலம், தமிழ்\nMar 2024\n1947, விடுதலை').points,[{date:'சங்க காலம்',label:'தமிழ்'},{date:'Mar 2024',label:''},{date:'1947',label:'விடுதலை'}]);
  assert.ok(parsePoints('one').error); assert.ok(parsePoints(', label\n1947').error);
  const item={length:3,enter:{duration:1.2,preset:'reveal'},graphic:{kind:'timeline-bar',points:[{date:'a'},{date:'b'},{date:'c'}]}};
  const times=timelineStates(item);
  assert.equal(times[12],.6); assert.equal(times[24],1.2);
  assert.equal(graphicState(item,.6),12); assert.equal(graphicState(item,.6-1e-6),11);
});

test('preview event states agree with Python, including both sides of every tap', () => {
  const item = { id:'steps', start:0, length:3, text:'Steps', enter:{preset:'reveal',duration:1.2}, graphic:{kind:'step-list',style:'clean',from:[.5,.5],to:[.5,.5],steps:['one','two','three'],step_times:[.25,.75,1.25]} };
  const samples = [0, .25-1e-6,.25,.25+1e-6,.749999,.75,.750001,1.249999,1.25,1.250001,2.9];
  const backend = JSON.parse(execFileSync('../backend/.venv/bin/python', ['-c', 'import json,sys; from app.services.timeline_schema import Text; from app.services.explainer_graphics import state_at; from app.services.step_graphics import step_states; d=json.load(sys.stdin); i=Text.model_validate(d["item"]); print(json.dumps({"times":step_states(i,24),"states":[state_at(i,t,24) for t in d["samples"]]}))'], { cwd:process.cwd(), env:{...process.env,PYTHONPATH:'../backend'}, input:JSON.stringify({item,samples}), encoding:'utf8' }));
  assert.deepEqual(stepStates(item), backend.times);
  assert.deepEqual(samples.map((at)=>graphicState(item,at,24)), backend.states);
});

test('trimming the start of a step list keeps each tapped step on its moment', async () => {
  const { trimText } = await import('../src/timeline/model.ts');
  const steps = { id: 's', start: 10, length: 4, text: 'Steps', style: 'plain', position: 'center', color: '#ffffff', size: 44,
    graphic: { kind: 'step-list', style: 'clean', from: [.5, .5], to: [.5, .5], width: .8, height: .8, line_width: .006, steps: ['a', 'b', 'c'], step_times: [.5, 1.5, 3] } };
  const timeline = { format: { width: 1280, height: 720, fps: 24 }, layers: [{ id: 'main', kind: 'video', items: [] }, { id: 'g', kind: 'text', name: 'Graphics', items: [steps] }] };
  const later = trimText(timeline, 's', 'in', 11).layers[1].items[0];
  assert.equal(later.start, 11); assert.deepEqual(later.graphic.step_times, [0, .5, 2]);
  const earlier = trimText(timeline, 's', 'in', 12).layers[1].items[0];
  assert.deepEqual(earlier.graphic.step_times, [0, .001, 1]);
});
