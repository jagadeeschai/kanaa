import test from 'node:test';
import assert from 'node:assert/strict';
import {CINEMATIC_TEMPLATES,cinematicJoin,addTemplateEffects,cinematicJoinTime} from '../src/timeline/cinematicTemplates.ts';
import {TEMPLATES,fromTemplate} from '../src/timeline/templates.ts';
test('cinematic buttons carry their materials, matte and companion lights',()=>{
 for(const template of CINEMATIC_TEMPLATES){assert.ok(TEMPLATES.includes(template));const title=fromTemplate(template,'t',2,4);assert.equal(title.depth.material,'gold');assert.equal(template.extra.effects.length,template.id==='verse-change'?1:2);}
 assert.equal(CINEMATIC_TEMPLATES[0].look.enter.preset,'fly-reveal');
});
test('verse changes preserve other joins and locked timelines',()=>{
 const main={id:'main',kind:'video',items:[{id:'a',start:0},{id:'b',start:4},{id:'c',start:8}]};
 const timeline={version:2,format:{width:640,height:360,fps:30},layers:[main]};
 const next=cinematicJoin(timeline,4);assert.equal(next.layers[0].items[1].transition_in.kind,'light-wipe');assert.equal(next.layers[0].items[2],main.items[2]);
 const locked={...timeline,layers:[{...main,locked:true}]};assert.equal(cinematicJoin(locked,4),locked);
});

test('companion effects are requested once each, sequentially',async()=>{
 const calls=[];let active=0;
 await addTemplateEffects(CINEMATIC_TEMPLATES[0],1,4,async(id,start,length)=>{assert.equal(active,0);active++;calls.push([id,start,length]);await new Promise(r=>setTimeout(r,1));active--;});
 assert.deepEqual(calls,[['volumetric-rays',1,4],['beam-sparkle-dust',1,4]]);
 const timeline={layers:[{id:'main',kind:'video',items:[{start:0},{start:4},{start:8}]}]};assert.equal(cinematicJoinTime(timeline,5),4);
});

test('verse bloom peaks on the nearest detected song beat',async()=>{
 const calls=[];const timeline={layers:[{kind:'audio',items:[{asset_id:'song',start:0,in:0,out:8,speed:1}]}]};
 await addTemplateEffects(CINEMATIC_TEMPLATES[2],4,3,async(...args)=>{calls.push(args);},timeline,async()=>({beats:[3.5,4.1,4.5]}));
 assert.ok(Math.abs(calls[0][1]-(4.1-1/30))<1e-6);
 assert.equal(calls[0][2],.6);
});
