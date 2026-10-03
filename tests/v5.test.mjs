import test from 'node:test';

test('ZIP backup includes exact original bytes and UTF-8 names',async()=>{
 const {createArchive}=await import('../dist/archive.mjs');
 const blob=await createArchive([{name:'videos/IRER.webm',blob:new Blob([new Uint8Array([1,2,3,4])])},{name:'result.json',blob:new Blob(['{"version":"5.0"}'])}]);
 const b=new Uint8Array(await blob.arrayBuffer()),v=new DataView(b.buffer);
 assert.equal(v.getUint32(0,true),0x04034b50);
 const nameLength=v.getUint16(26,true);
 assert.equal(new TextDecoder().decode(b.slice(30,30+nameLength)),'videos/IRER.webm');
 assert.deepEqual([...b.slice(30+nameLength,34+nameLength)],[1,2,3,4]);
 assert.equal(v.getUint32(14,true),0xb63cfbcd);
 assert.equal(v.getUint16(b.length-12,true),2);
});
import assert from 'node:assert/strict';
import {AutoCapture,externalRotation,evaluate,DEFAULT_CRITERIA,validateCriteria,mergeRefinement} from '../dist/v5-core.mjs';
import {analyzeRom} from '../dist/analysis.mjs';
test('IRER measures body-relative rotation, not elbow flexion',()=>{
 const world={left_shoulder:{x:.2,y:0,z:0},right_shoulder:{x:-.2,y:0,z:0},left_hip:{x:.2,y:.5,z:0},right_hip:{x:-.2,y:.5,z:0},right_elbow:{x:-.2,y:.3,z:0},right_wrist:{x:-.2-.3*Math.sin(Math.PI/3),y:.3,z:-.3*Math.cos(Math.PI/3)}};
 assert.ok(Math.abs(externalRotation(world,'right')-60)<.001);
 const mirrored=Object.fromEntries(Object.entries(world).map(([k,p])=>[k.replace('left','TEMP').replace('right','left').replace('TEMP','right'),{...p,x:-p.x}]));
 assert.ok(Math.abs(externalRotation(mirrored,'left')-60)<.001);
 assert.equal(externalRotation(null,'right'),null);
});
test('auto capture requires stable neutral, movement then stable return',()=>{
 const a=new AutoCapture(),neutral={valid:true,neutral:true,excursion:false},moved={valid:true,neutral:false,excursion:true};
 assert.equal(a.update(neutral,0,false),null);assert.equal(a.update(neutral,1500,false),'start');
 assert.equal(a.update(neutral,4000,true),null);
 a.update(moved,5000,true);a.update(neutral,6000,true);a.update({valid:false},7000,true);
 assert.equal(a.update(neutral,7500,true),null);assert.equal(a.update(neutral,8700,true),'stop');
});
test('score boundaries and missing/confirmation gates',()=>{
 const sessions=Object.fromEntries(['AB','FE','ER','BIR','IRER'].map(code=>[code,{rom:{valid:true,maxAngle:180},analysisStatus:'complete',measurementConfirmed:true,birManualSpineLevel:'T7'}]));
 assert.equal(evaluate(sessions).total,0);
 sessions.AB.rom.maxAngle=120;assert.equal(evaluate(sessions).rows[0].score,1);
 sessions.IRER.measurementConfirmed=false;assert.equal(evaluate(sessions).total,null);
 sessions.IRER.measurementConfirmed=true;sessions.BIR.birManualSpineLevel=null;assert.equal(evaluate(sessions).total,null);
 const c=structuredClone(DEFAULT_CRITERIA);c.weights.AB=99;assert.throws(()=>validateCriteria(c));
});
test('refinement preserves edits and orders source frames',()=>{
 const raw={p:{x:.1,y:.2}},old={sourceFrame:0,time:0,raw,corrected:{p:{x:.4,y:.2,status:'manual'}},phase:'준비'};
 const fresh={sourceFrame:0,time:0,raw,corrected:structuredClone(raw)};
 const merged=mergeRefinement([old],[{...fresh,sourceFrame:1,time:.03},fresh]);
 assert.equal(merged[0].corrected.p.x,.4);assert.equal(merged[1].index,1);
});
