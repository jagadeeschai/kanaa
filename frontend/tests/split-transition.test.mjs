import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {splitPanels} from '../src/timeline/split-transition.ts';
test('split geometry matches Python at endpoints and intermediate frames',()=>{
 const samples=[];for(const n of [2,3,4])for(const direction of ['horizontal','vertical','diagonal'])for(const p of [0,.25,.5,.9,1])for(const style of ['clean','gap','shadow'])samples.push([p,n,direction,426,240,style]);
 const py=execFileSync('../backend/.venv/bin/python',['-c','import sys,json;sys.path.insert(0,"../backend");from app.services.split_transition import panels;print(json.dumps([panels(*x) for x in json.load(sys.stdin)]))'],{input:JSON.stringify(samples),encoding:'utf8'});
 assert.deepEqual(samples.map(x=>splitPanels(...x)),JSON.parse(py));
});

import {readFileSync} from 'node:fs';
test('Ask AI takes Split from the catalog, and every-cut retains its options', async()=>{
 const editor=readFileSync(new URL('../src/editor/Editor.tsx',import.meta.url),'utf8');assert.match(editor,/transitions: TRANSITIONS.map/);assert.ok(editor.split('\n').length-1<=1200);
 const catalog=readFileSync(new URL('../src/editor/transition-catalog.tsx',import.meta.url),'utf8');assert.match(catalog,/id:'split',label:'Split'/);
 const {transitionEverywhere}=await import('../src/timeline/transitions.ts');const tr={kind:'split',duration:.6,split_panels:4,split_direction:'diagonal',split_style:'shadow'};
 const timeline={layers:[{id:'main',kind:'video',items:[{id:'a'},{id:'b'}]}]};assert.deepEqual(transitionEverywhere(timeline,'split',.6,tr).layers[0].items[1].transition_in,tr);
});
