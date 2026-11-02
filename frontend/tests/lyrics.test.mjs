import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLyricTimeline, plainLyricLines, validateLyricCues } from '../src/utils/lyrics.ts';

test('LRC repeats and fractional seconds keep the supplied lyrics',()=>{
 const cues=buildLyricTimeline('[ar:Artist]\n[00:01.50][00:05.00]தமிழ் பாடல்\n[00:03]Morning light',8);
 assert.deepEqual(cues.map(c=>[c.start,c.end]),[[1.5,3],[3,5],[5,8]]);
 assert.equal(cues[0].text,'தமிழ் பாடல்');
 assert.deepEqual(plainLyricLines('[ti:Title]\n[00:01]Morning light'),['Morning light']);
});
test('manual fallback is visibly marked for review',()=>{
 const cues=buildLyricTimeline('One line\nAnother line',10);
 assert.equal(cues[0].end,5);assert(cues.every(c=>c.review));
 assert(validateLyricCues(cues,10));
});
test('overlapping, blank, and out of bounds lyrics cannot export',()=>{
 assert(!validateLyricCues([{start:0,end:3,text:'One'},{start:2,end:4,text:'Two'}],5));
 assert(!validateLyricCues([{start:0,end:3,text:' '}],5));
 assert(!validateLyricCues([{start:0,end:6,text:'One'}],5));
 assert.throws(()=>buildLyricTimeline('[00:08]Late',5));
});
