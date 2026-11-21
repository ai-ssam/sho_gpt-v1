import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIRER,sessionIRER,irerFrame,irerSummary,legacy3D} from '../dist/irer-methods.mjs';
import {externalRotation,evaluate,DEFAULT_CRITERIA,poseState} from '../dist/v5-core.mjs';
function frame(two,three,index=0){
 const p=(x,y)=>({x,y,visibility:1,aspectRatio:1,status:'detected'});
 const corrected={left_shoulder:p(.7,.2),left_elbow:p(.7,.5),left_wrist:p(.7,.75),right_shoulder:p(.3,.2),right_elbow:p(.3,.5),right_wrist:p(.3-.25*Math.sin(two*Math.PI/180),.5)};
 const worldRaw={left_shoulder:{x:.2,y:0,z:0},right_shoulder:{x:-.2,y:0,z:0},left_hip:{x:.2,y:.5,z:0},right_hip:{x:-.2,y:.5,z:0},right_elbow:{x:-.2,y:.3,z:0},right_wrist:{x:-.2-.3*Math.sin(three*Math.PI/180),y:.3,z:-.3*Math.cos(three*Math.PI/180)}};
 return {corrected,worldRaw,index,sourceFrame:index*3,time:index*.1,motion:'IRER'};
}
test('IRER defaults, strict mode validation and legacy record resolution',()=>{
 assert.equal(normalizeIRER().primary,'2d');assert.equal(normalizeIRER({mode:'3d'}).primary,'3d');assert.throws(()=>normalizeIRER({mode:'auto'}));assert.throws(()=>normalizeIRER({mode:'compare',primary:'average'}));
 assert.equal(sessionIRER({rom:{primaryLabel:'최대 외회전각 (3D 추정)'}}).mode,'3d');assert.equal(sessionIRER({rom:{method:'irer-2d-asin-v1'}}).mode,'2d');
});
test('IRER same-frame comparison is not averaged; peaks retain distinct source frames',()=>{
 const frames=[frame(30,60,0),frame(60,30,1)],r=irerSummary(frames,'right',{mode:'compare',primary:'2d'});
 assert.ok(Math.abs(r.maxAngle-60)<1e-6);assert.equal(r.representativeFrameIndex,1);assert.equal(r.comparison.twoMax.sourceFrame,3);assert.equal(r.comparison.threeMax.sourceFrame,0);assert.ok(Math.abs(r.comparison.sameFrame[0].difference-30)<1e-6);
 const other=irerSummary(frames,'right',{mode:'compare',primary:'3d'});assert.equal(other.representativeFrameIndex,0);assert.equal(other.method,'irer-3d-legacy-v1');
});
test('IRER missing depth requires reanalysis; never falls back to 2D for a 3D primary',()=>{
 const f=frame(30,60);delete f.worldRaw;
 const two=irerSummary([f],'right',{mode:'compare',primary:'2d'});assert.equal(two.valid,true);assert.equal(two.requiresReanalysis,true);assert.equal(two.comparison.threeMax,null);
 const three=irerSummary([f],'right',{mode:'compare',primary:'3d'});assert.equal(three.valid,false);assert.equal(three.maxAngle,null);assert.match(three.secondaryLabel,/재분석/);
 assert.equal(poseState(f.corrected,null,'right','IRER','right',{mode:'3d'}).valid,false);
});
test('IRER 3D legacy math and rejection gate remain unchanged; 2D editing affects only 2D',()=>{
 const f=frame(30,60);assert.equal(legacy3D(f.worldRaw,'right').angle,externalRotation(f.worldRaw,'right'));
 const before=irerFrame(f,'right',{mode:'compare'});f.corrected.right_wrist.x=.3-.25*Math.sin(Math.PI/3);const after=irerFrame(f,'right',{mode:'compare'});assert.ok(after.two.angle>before.two.angle);assert.equal(after.three.angle,before.three.angle);
 f.worldRaw.right_wrist.z=0;assert.equal(legacy3D(f.worldRaw,'right').angle,null);assert.match(legacy3D(f.worldRaw,'right').warnings.join(),/90°/);
});
test('IRER score uses the primary only; failed primary remains pending',()=>{
 const c=structuredClone(DEFAULT_CRITERIA);c.activeMotions=['IRER'];c.weights.IRER=100;
 const f=frame(30,65),s={frames:[f],measurementConfirmed:true,analysisStatus:'complete'};
 s.rom=irerSummary([f],'right',{mode:'compare',primary:'2d'});assert.ok(Math.abs(evaluate({IRER:s},c).total-200/3)<1e-6);
 s.rom=irerSummary([f],'right',{mode:'compare',primary:'3d'});assert.equal(evaluate({IRER:s},c).total,0);
 delete f.worldRaw;s.rom=irerSummary([f],'right',{mode:'3d'});assert.equal(evaluate({IRER:s},c).total,null);
});
