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
import {classifyScore,validateStages} from '../dist/v5-core.mjs';
import {trackedHandPoint} from '../dist/analysis.mjs';
import {makeTemplate,templatePose,validateCapture,templateStore} from '../dist/neutral.mjs';
import {indexedDB} from 'fake-indexeddb';
import {signedElevation,fe2Metrics,birHeight,calibrateIRER,irerAuxiliary} from '../dist/motion-metrics.mjs';
import {irer2D} from '../dist/motion-metrics.mjs';
import {poseState} from '../dist/v5-core.mjs';
test('IRER 2D opposite forearm reference: 0/30/60/90°, mirror and no world dependency',()=>{
 const p=(x,y)=>({x,y,visibility:1,aspectRatio:1});const points={left_shoulder:p(.7,.2),left_elbow:p(.7,.5),left_wrist:p(.7,.75),right_shoulder:p(.3,.2),right_elbow:p(.3,.5),right_wrist:p(.3,.5)};
 for(const angle of [0,30,60,90]){points.right_wrist.x=.3-.25*Math.sin(angle*Math.PI/180);const m=irer2D(points,'right');assert.ok(Math.abs(m.angle-angle)<1e-5);assert.equal(m.source,'opposite-forearm');const mirror=Object.fromEntries(Object.entries(points).map(([id,v])=>[id.replace('left','TEMP').replace('right','left').replace('TEMP','right'),{...v,x:1-v.x}]));assert.ok(Math.abs(irer2D(mirror,'left').angle-angle)<1e-5);}
 const r=analyzeRom([{corrected:points,worldRaw:{},sourceFrame:0,time:0}],'right','IRER');assert.equal(r.valid,true);assert.ok(Math.abs(r.maxAngle-90)<1e-5);assert.equal(r.method,'irer-2d-asin-v1');assert.equal(r.diagnostics.length,1);assert.equal(poseState(points,null,'right','IRER').excursion,true);points.right_wrist.x=.3;assert.equal(poseState(points,null,'right','IRER').neutral,true);
 points.right_wrist.x=-.01;assert.equal(irer2D(points,'right').angle,null);
 points.right_wrist.x=.2;points.right_elbow.x=.5;assert.match(irer2D(points,'right').warnings.join(),/몸통 이탈/);
});
test('IRER 2D personal calibration, correction, aspect ratio and straight reference arm gates',()=>{
 const p=(x,y)=>({x,y,visibility:1,aspectRatio:2});const points={left_shoulder:p(.7,.2),left_elbow:p(.7,.5),left_wrist:p(.7,.8),right_shoulder:p(.3,.2),right_elbow:p(.3,.5),right_wrist:p(.175,.5)};
 const c=calibrateIRER(points,'right');points.right_wrist.x=.2375;const m=irer2D(points,'right',c);assert.ok(Math.abs(m.angle-30)<1e-5);assert.equal(m.source,'personal-calibration');
 points.right_wrist.visibility=0;assert.equal(irer2D(points,'right',c).angle,null);points.right_wrist.status='manual';assert.ok(Math.abs(irer2D(points,'right',c).angle-30)<1e-5);
 points.left_wrist.x=.9;assert.equal(irer2D(points,'right').angle,null);
});
import {validateSettingsBackup} from '../dist/v52-full-ui.mjs';
import {drawMeasurementSector} from '../dist/angle-sector.mjs';

test('representative angle wedge uses measured shoulder vectors and rejects missing points',()=>{
 const arcs=[],labels=[],ctx=new Proxy({arc:(...args)=>arcs.push(args),fillText:text=>labels.push(text)},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 const corrected={right_shoulder:{x:.5,y:.3,visibility:1},right_hip:{x:.5,y:.7,visibility:1},right_elbow:{x:.8,y:.3,visibility:1}};
 assert.equal(drawMeasurementSector(ctx,1000,1000,{corrected},'right','AB'),true);assert.ok(Math.abs(Math.abs(arcs[0][4]-arcs[0][3])-Math.PI/2)<1e-6);assert.equal(labels[0],'90.0°');assert.equal(drawMeasurementSector(ctx,1000,1000,{corrected:{}},'right','AB'),false);
});

test('settings restore rejects invalid capture duration and missing template references before writing',()=>{
 const backup={schema:'shoulder-settings-1',criteria:structuredClone(DEFAULT_CRITERIA),templates:[],selected:{},capture:{startSeconds:1.5,returnSeconds:1.2}};
 assert.equal(validateSettingsBackup(backup),backup);
 assert.throws(()=>validateSettingsBackup({...backup,capture:{startSeconds:-1,returnSeconds:1}}),/유지시간/);
 assert.throws(()=>validateSettingsBackup({...backup,selected:{'AB:right':'absent'}}),/버전/);
});

function sidePoints(angle,arm='right',facing='right'){
 const p=(x,y)=>({x,y,visibility:1,aspectRatio:1}),r=angle*Math.PI/180;
 return {[arm+'_shoulder']:p(.5,.35),[arm+'_hip']:p(.5,.85),[arm+'_elbow']:p(.5+Math.sin(r)*.25*(facing==='right'?1:-1),.35+Math.cos(r)*.25)};
}
test('FE2 signed extremes, mirror/side invariance and explicit endpoint corrections',()=>{
 for(const arm of ['left','right'])for(const facing of ['left','right']){
  const frames=[0,-20,-45,0,60,170,0].map(a=>({corrected:sidePoints(a,arm,facing)}));
  assert.ok(Math.abs(signedElevation(frames[2].corrected,arm,facing)+45)<1e-6);
  const r=fe2Metrics(frames,arm,{facing});assert.equal(r.valid,true);assert.ok(Math.abs(r.rom-215)<1e-6);assert.equal(r.extensionFrameIndex,2);assert.equal(r.flexionFrameIndex,5);
  assert.ok(Math.abs(fe2Metrics(frames,arm,{facing,fe2ExtensionFrame:1}).rom-190)<1e-6);
 }
 assert.equal(fe2Metrics([{corrected:sidePoints(0)},{corrected:sidePoints(90)}],'right').valid,false);
});
test('FE2 auto stop requires extension then flexion, not the intermediate neutral crossing',()=>{
 const a=new AutoCapture({startSeconds:1,returnSeconds:1}),neutral={valid:true,neutral:true,motion:'FE2'};
 a.update(neutral,0,false);assert.equal(a.update(neutral,1000,false),'start');
 a.update({valid:true,excursion:true,extension:true,motion:'FE2'},2000,true);a.update(neutral,3000,true);assert.equal(a.update(neutral,5000,true),null);
 a.update({valid:true,excursion:true,flexion:true,motion:'FE2'},6000,true);a.update(neutral,7000,true);assert.equal(a.update(neutral,8000,true),'stop');
});
test('BIR t levels use wrist, tilted reference lines and half-away-from-zero rounding',()=>{
 const p=(x,y)=>({x,y,visibility:1}),points={left_shoulder:p(.3,.2),right_shoulder:p(.7,.3),left_hip:p(.3,.7),right_hip:p(.7,.8),right_wrist:p(.5,.75)};
 assert.equal(birHeight(points,'right').integer,0);points.right_wrist.y=.25;assert.equal(birHeight(points,'right').integer,10);
 points.right_wrist.y=.825;assert.equal(birHeight(points,'right').integer,-1);points.right_wrist.y=.15;assert.equal(birHeight(points,'right').integer,12);
 points.right_wrist.visibility=0;assert.equal(birHeight(points,'right'),null);
});
test('IRER calibrated auxiliary angle and uncertainty gates',()=>{
 const p=(x,y)=>({x,y,visibility:1,aspectRatio:1}),points={left_shoulder:p(.7,.2),left_elbow:p(.7,.5),right_shoulder:p(.3,.2),right_elbow:p(.3,.5),right_wrist:p(.05,.5),right_hip:p(.3,.8)};
 const calibration=calibrateIRER(points,'right');const moved=structuredClone(points);moved.right_wrist.x=.3-.25*Math.sin(Math.PI/6);
 const aux=irerAuxiliary(moved,'right',calibration,30);assert.ok(Math.abs(aux.angle-30)<1e-6);assert.equal(aux.warnings.length,0);assert.equal(aux.inferredPoint.status,'estimated');
 assert.ok(irerAuxiliary(moved,'right',calibration,65).warnings.includes('3D·길이 추정 불일치'));
 moved.right_wrist.visibility=0;assert.equal(irerAuxiliary(moved,'right',calibration,30).angle,null);
 assert.equal(irerAuxiliary(points,'left',calibration,30).angle,null);
});
test('active criteria validate and legacy score snapshots remain supported',()=>{
 const c=structuredClone(DEFAULT_CRITERIA);c.activeMotions=['AB'];c.weights.AB=100;assert.doesNotThrow(()=>validateCriteria(c));
 assert.equal(evaluate({AB:{rom:{valid:true,maxAngle:160}}},c).total,0);
 c.activeMotions=['AB','AB'];assert.throws(()=>validateCriteria(c));
 const legacy=structuredClone(DEFAULT_CRITERIA);delete legacy.activeMotions;delete legacy.birMode;legacy.weights={AB:25,FE:25,ER:10,BIR:15,IRER:25};
 assert.doesNotThrow(()=>validateCriteria(legacy));assert.equal(evaluate({},legacy).rows.length,5);
});

test('v5.2 configurable stage boundaries include exact edges and reject invalid settings',()=>{
 const stages={boundaries:[25,60],labels:['제한 적음','경도','중증도']};
 for(const [v,color]of [[0,'green'],[24.999,'green'],[25,'yellow'],[59.999,'yellow'],[60,'red'],[100,'red'],[null,'pending']])assert.equal(classifyScore(v,stages).color,color);
 assert.throws(()=>validateStages({...stages,boundaries:[60,25]}));assert.throws(()=>validateStages({...stages,labels:['','','']}));
});
test('v5.2 custom dwell time, invalid detection resets duration',()=>{
 const a=new AutoCapture({startSeconds:3,returnSeconds:2}),neutral={valid:true,neutral:true};
 a.update(neutral,0,false);assert.equal(a.update(neutral,1500,false),null);assert.equal(a.update(neutral,3000,false),'start');
 a.update({valid:true,excursion:true},3100,true);a.update(neutral,4000,true);a.update({valid:false},5500,true);a.update(neutral,6000,true);
 assert.equal(a.update(neutral,7999,true),null);assert.equal(a.update(neutral,8000,true),'stop');
 assert.throws(()=>validateCapture({startSeconds:0,returnSeconds:1}));
});
test('v5.2 BIR always uses wrist and does not fall back to thumb',()=>{
 const p={right_hand_tip:{x:.5,y:.1,visibility:1},right_wrist:{x:.5,y:.4,visibility:1}};
 assert.equal(trackedHandPoint(p,'right','bir','thumb').y,.4);p.right_wrist.visibility=0;assert.equal(trackedHandPoint(p,'right','bir'),null);
});
test('v5.2 neutral template source, normalized comparison and immutable version storage',async()=>{
 globalThis.indexedDB=indexedDB;
 const corrected={right_shoulder:{x:.5,y:.2,visibility:1},right_elbow:{x:.5,y:.4,visibility:1},right_wrist:{x:.5,y:.6,visibility:1},right_hip:{x:.5,y:.7,visibility:1}};
 const input={motion:'AB',arm:'right',view:'정면',image:'data:image/jpeg;base64,AAAA',raw:corrected,corrected,source:{kind:'upload',fileName:'neutral.mp4',time:1.5,frameIndex:45}};
 const first=makeTemplate(input),second=makeTemplate(input);assert.notEqual(first.id,second.id);
 assert.equal(templatePose(corrected,'right',first).neutral,true);
 const shifted=Object.fromEntries(Object.entries(corrected).map(([k,p])=>[k,{...p,x:p.x*.8+.1,y:p.y*.8+.1}]));assert.equal(templatePose(shifted,'right',first).neutral,true);
 assert.equal(templatePose(corrected,'left',first).valid,false);
 await templateStore('save',first);await templateStore('save',second);const list=await templateStore('list');assert.equal(list.length,2);assert.equal(list[0].source.time,1.5);
 await assert.rejects(()=>templateStore('save',first));
});
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
 const sessions=Object.fromEntries(['AB','FE2','BIR','IRER'].map(code=>[code,{rom:{valid:true,maxAngle:180,rom:220,tRaw:10,divisions:10},analysisStatus:'complete',measurementConfirmed:true,birManualSpineLevel:'T7'}]));
 assert.equal(evaluate(sessions).total,0);
 sessions.AB.rom.maxAngle=120;assert.equal(evaluate(sessions).rows[0].score,1);
 sessions.IRER.measurementConfirmed=false;assert.equal(evaluate(sessions).total,null);
 sessions.IRER.measurementConfirmed=true;sessions.BIR.rom.tRaw=null;assert.equal(evaluate(sessions).total,null);
  sessions.BIR.rom.tRaw=10;sessions.IRER.irerCalibration={id:'test'};sessions.IRER.rom.auxiliary={quality:'확인 필요'};assert.equal(evaluate(sessions).total,null);sessions.IRER.rom.auxiliary.quality='비교 가능';assert.notEqual(evaluate(sessions).total,null);
 const c=structuredClone(DEFAULT_CRITERIA);c.weights.AB=99;assert.throws(()=>validateCriteria(c));
});
test('refinement preserves edits and orders source frames',()=>{
 const raw={p:{x:.1,y:.2}},old={sourceFrame:0,time:0,raw,corrected:{p:{x:.4,y:.2,status:'manual'}},phase:'준비'};
 const fresh={sourceFrame:0,time:0,raw,corrected:structuredClone(raw)};
 const merged=mergeRefinement([old],[{...fresh,sourceFrame:1,time:.03},fresh]);
 assert.equal(merged[0].corrected.p.x,.4);assert.equal(merged[1].index,1);
});
