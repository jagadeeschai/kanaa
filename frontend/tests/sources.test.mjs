import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sourceCatalog,sourceRollLines,missingSources,decorateSources } from '../src/timeline/sources.ts';
import { duration } from '../src/timeline/model.ts';

test('source catalog, Tamil roll lines and duration agree with the backend',()=>{
  const graphic={kind:'count-up',style:'clean',from:[.5,.5],to:[.5,.5],width:.3,height:.2,line_width:.006};
  const timeline={version:2,format:{width:426,height:240,fps:24},sources_roll:true,layers:[{id:'text',kind:'text',items:[{id:'number',text:'2,000 years',start:0,length:3,graphic,source:'தமிழ் ஆய்வு அறிக்கை '.repeat(12)},{id:'other',text:'42',start:3,length:2,graphic}]}]};
  assert.equal(missingSources(timeline).length,1);const drawn=decorateSources(timeline);assert.equal(decorateSources(drawn).layers.length,drawn.layers.length);
  const code='import json,sys;from app.services.timeline_schema import Timeline;from app.services.source_graphics import catalog,roll_lines;t=Timeline.model_validate(json.load(sys.stdin));print(json.dumps({"catalog":catalog(t.model_dump(by_alias=True)),"lines":roll_lines(catalog(t.model_dump(by_alias=True))),"duration":t.duration}))';
  const backend=JSON.parse(execFileSync('../backend/.venv/bin/python',['-c',code],{env:{...process.env,PYTHONPATH:'../backend'},input:JSON.stringify(timeline),encoding:'utf8'}));
  assert.deepEqual(sourceCatalog(timeline),backend.catalog);assert.deepEqual(sourceRollLines(sourceCatalog(timeline)),backend.lines);assert.equal(duration(timeline),backend.duration);assert.equal(duration(drawn),backend.duration);
});
