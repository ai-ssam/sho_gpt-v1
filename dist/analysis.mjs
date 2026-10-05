import {fe2Metrics,birHeight,irer2D} from './motion-metrics.mjs?v=5.2.0-irer2d';
// v5 measurement policy; CIR remains available for legacy records.
export * from './geometry.mjs';
import { shoulderAngles, elbowAngles, LANDMARKS, isEdited } from './geometry.mjs';
export const POLICY = Object.freeze({ visibility: .45, shoulderTolerance: .05, gapFrames: 5, gapSeconds: .2, version: '5.2-wrist-provisional' });
export const usable = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.status === 'manual' || Number(p.visibility ?? 0) >= POLICY.visibility);
export function visiblePointIds(arm, motion) {
  return LANDMARKS.filter(p => !['FE2','FE','ER','CIR'].includes(motion) || p.id.startsWith(arm + '_')).map(p=>p.id);
}
export function trackedHandPoint(points, arm, policy = 'bir', preference = 'auto') {
  const tip = points[arm+'_hand_tip'], wrist = points[arm+'_wrist'];
  if(policy==='bir')return usable(wrist)?{...wrist,source:'손목',status:wrist.status==='manual'?'manual':'detected'}:null;
  if (preference !== 'wrist' && usable(tip)) return { ...tip, source: '엄지손가락', status: tip.status === 'manual' ? 'manual' : 'detected' };
  if (policy !== 'cir' && preference !== 'thumb' && usable(wrist)) return { ...wrist, source:'손목', status:wrist.status === 'manual' ? 'manual' : 'detected' };
  return null;
}
export function cirTrack(frames, arm, options = {}) {
  const maxFrames = options.gapFrames ?? POLICY.gapFrames, maxSeconds = options.gapSeconds ?? POLICY.gapSeconds;
  const rows = frames.map((f,index) => {
    const shoulder=f.corrected[arm+'_shoulder'], hip=f.corrected[arm+'_hip'];
    const hand=trackedHandPoint(f.corrected,arm,'cir');
    return {index,time:f.time,sourceFrame:f.sourceFrame??index,hand,shoulder,hip,status:hand?.status??'missing'};
  });
  let previous = -1;
  for (let i=0;i<rows.length;i++) {
    if (!rows[i].hand) continue;
    if (previous >= 0 && i > previous+1) {
      const a=rows[previous], b=rows[i], gap=b.sourceFrame-a.sourceFrame-1;
      if (gap<=maxFrames && b.time-a.time<=maxSeconds+1e-7 && b.time>a.time) {
        for(let j=previous+1;j<i;j++) {
          const t=(rows[j].time-a.time)/(b.time-a.time);
          rows[j].hand={x:a.hand.x+(b.hand.x-a.hand.x)*t,y:a.hand.y+(b.hand.y-a.hand.y)*t,source:'엄지손가락',status:'interpolated'};
          rows[j].status='interpolated';
        }
      }
    }
    previous=i;
  }
  let segment=-1, connected=false;
  for(const row of rows) {
    const aspect=row.shoulder?.aspectRatio||1;
    const trunk=usable(row.shoulder)&&usable(row.hip) ? Math.hypot((row.hip.x-row.shoulder.x)*aspect,row.hip.y-row.shoulder.y):0;
    if(row.hand && trunk>.03) {
      if(!connected) segment++;
      row.segment=segment;
      row.relative={x:(row.hand.x-row.shoulder.x)*aspect/trunk,y:(row.hand.y-row.shoulder.y)/trunk,segment,index:row.index};
      connected=true;
    } else { row.relative=null; connected=false; }
  }
  return rows;
}
const deltaAngle=(b,a)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
function solve3(matrix,vector) {
  const a=matrix.map((row,i)=>[...row,vector[i]]);
  for(let i=0;i<3;i++) {
    let pivot=i; for(let j=i+1;j<3;j++) if(Math.abs(a[j][i])>Math.abs(a[pivot][i])) pivot=j;
    if(Math.abs(a[pivot][i])<1e-9)return null;
    [a[i],a[pivot]]=[a[pivot],a[i]];
    const divisor=a[i][i]; for(let k=i;k<4;k++) a[i][k]/=divisor;
    for(let j=0;j<3;j++) if(j!==i) {const f=a[j][i]; for(let k=i;k<4;k++)a[j][k]-=f*a[i][k];}
  }
  return a.map(row=>row[3]);
}
export function circleMetrics(path) {
  const clean=path.filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
  const invalid={valid:false,reason:'서로 다른 유효 손끝 좌표가 부족합니다.',circularity:0,wobbleIndex:100,coverageDegrees:0,closureError:100,direction:'판정 불가',directionConsistency:0};
  if(clean.length<6)return invalid;
  const matrix=Array.from({length:3},()=>[0,0,0]),vector=[0,0,0];
  for(const p of clean) {const r=[2*p.x,2*p.y,1], z=p.x*p.x+p.y*p.y; for(let i=0;i<3;i++){vector[i]+=r[i]*z;for(let j=0;j<3;j++)matrix[i][j]+=r[i]*r[j];}}
  const fit=solve3(matrix,vector); if(!fit)return invalid;
  const center={x:fit[0],y:fit[1]};
  const radii=clean.map(p=>Math.hypot(p.x-center.x,p.y-center.y));
  const mean=radii.reduce((a,b)=>a+b,0)/radii.length; if(mean<.01)return invalid;
  const wobble=Math.sqrt(radii.reduce((a,r)=>a+(r-mean)**2,0)/radii.length)/mean*100;
  let signed=0,travel=0,segmentSigned=0,maxCoverage=0;
  for(let i=1;i<clean.length;i++) {
    if(clean[i].segment!==clean[i-1].segment){ maxCoverage=Math.max(maxCoverage,Math.abs(segmentSigned));segmentSigned=0;continue; }
    const d=deltaAngle(Math.atan2(clean[i].y-center.y,clean[i].x-center.x),Math.atan2(clean[i-1].y-center.y,clean[i-1].x-center.x));
    signed+=d;travel+=Math.abs(d);segmentSigned+=d;maxCoverage=Math.max(maxCoverage,Math.abs(segmentSigned));
  }
  const coverage=Math.min(360,maxCoverage*180/Math.PI), consistency=travel?Math.abs(signed)/travel:0;
  return {valid:true,center,meanRadius:mean,minRadius:Math.min(...radii),maxRadius:Math.max(...radii),
    circularity:Math.max(0,100-wobble),wobbleIndex:wobble,coverageDegrees:coverage,
    closureError:Math.hypot(clean.at(-1).x-clean[0].x,clean.at(-1).y-clean[0].y)/mean*100,
    direction:consistency<.6?'혼합/역방향 포함':signed>=0?'시계방향':'반시계방향',directionConsistency:consistency*100};
}
export function detectCirRange(frames,arm='right',options={}) {
  const rows=cirTrack(frames,arm,options);
  const start=rows.find(r=>r.relative&&Math.abs(r.relative.y)<=POLICY.shoulderTolerance);
  if(!start) return {startFrameIndex:null,endFrameIndex:null,reason:'어깨 높이 시작점을 찾지 못했습니다. 시작·종료를 직접 지정하세요.'};
  let end=rows.findLast(r=>r.relative)?.index??start.index,reason='영상 끝', stationarySince=null;
  const path=[];
  for(let i=start.index;i<rows.length;i++) {
    const row=rows[i]; if(!row.relative) {stationarySince=null;continue;}
    path.push(row.relative);
    const previous=rows[i-1];
    const dist=previous?.relative?Math.hypot(row.relative.x-previous.relative.x,row.relative.y-previous.relative.y):Infinity;
    if(dist<.008){stationarySince??=row.time;} else stationarySince=null;
    if(path.length>=12) {
      const m=circleMetrics(path);
      if(m.valid && m.coverageDegrees>=300 && m.directionConsistency>=80 && m.closureError<=20){end=i;reason='시작점 복귀';break;}
      if(stationarySince!=null && row.time-stationarySince>=.8 && m.coverageDegrees>=60){end=i;reason='움직임 정지';break;}
    }
  }
  return {startFrameIndex:start.index,endFrameIndex:end,reason};
}
export function reachLevel(value) {
  return value>=1.18?'T7':value>=1.02?'T9':value>=.82?'T12':value>=.58?'L1':value>=.32?'L3':value>=.08?'L5':'천골';
}
export function analyzeRom(frames,arm='right',motion='AB',options={}) {
  if(!frames.length)return null;
  if(motion==='FE2')return {motion,arm,...fe2Metrics(frames,arm,options)};
  const angles=frames.map((f,index)=>({index,value:shoulderAngles(f.corrected)[arm]})).filter(r=>Number.isFinite(r.value));
  const min=angles.reduce((a,b)=>b.value<a.value?b:a,{index:null,value:Infinity}),max=angles.reduce((a,b)=>b.value>a.value?b:a,{index:null,value:-Infinity});
  const base={motion,arm,rom:angles.length?max.value-min.value:null,minAngle:angles.length?min.value:null,maxAngle:angles.length?max.value:null,minFrameIndex:min.index,maxFrameIndex:max.index,representativeFrameIndex:max.index,primaryLabel:'어깨 가동범위',primaryValue:angles.length?+(max.value-min.value).toFixed(1):'미검출',primaryUnit:'°',secondaryLabel:angles.length?`${min.value.toFixed(1)}° → ${max.value.toFixed(1)}°`:'유효 관절점 부족',valid:angles.length>0,validFrames:angles.length};
  if(motion==='IRER') {
    const samples=frames.map((f,index)=>({index,measurement:irer2D(f.corrected,arm,options.irerCalibration,options.irerOptions)}));
    const rows=samples.filter(r=>Number.isFinite(r.measurement.angle)).map(r=>({...r,value:r.measurement.angle}));
    const diagnostics=samples.map(r=>({index:r.index,sourceFrame:frames[r.index].sourceFrame,time:frames[r.index].time,...r.measurement}));
    if(!rows.length)return {...base,valid:false,rom:null,minAngle:null,maxAngle:null,primaryValue:'확인 필요',primaryLabel:'외회전각 (2D 길이비)',primaryUnit:'',secondaryLabel:[...new Set(samples.flatMap(r=>r.measurement.warnings))].join(' / '),representativeFrameIndex:0,method:'irer-2d-asin-v1',diagnostics};
    const lo=rows.reduce((a,b)=>a.value<b.value?a:b),hi=rows.reduce((a,b)=>a.value>b.value?a:b);
    const auxiliary=hi.measurement;
    return {...base,valid:true,rom:hi.value-lo.value,minAngle:lo.value,maxAngle:hi.value,minFrameIndex:lo.index,maxFrameIndex:hi.index,representativeFrameIndex:hi.index,primaryValue:+hi.value.toFixed(1),primaryLabel:'최대 외회전각 (2D 길이비)',primaryUnit:'°',secondaryLabel:(auxiliary.source==='personal-calibration'?'개인 전완 보정':'반대팔 전완 참조')+' · '+auxiliary.warnings.join(' / '),validFrames:rows.length,method:auxiliary.method,diagnostics,auxiliary,calibration:options.irerCalibration??null};
  }
  if(motion==='BIR') {
    if(options.birMode==='relative-t'){
      const rows=frames.map((f,index)=>({index,height:birHeight(f.corrected,arm,options.birDivisions??10),elbow:elbowAngles(f.corrected)[arm]}));
      const best=rows.filter(r=>r.height).reduce((a,b)=>!a||b.height.raw>a.height.raw?b:a,null),elbow=rows.filter(r=>Number.isFinite(r.elbow)).reduce((a,b)=>!a||b.elbow<a.elbow?b:a,null);
      return {...base,valid:!!best,primaryLabel:'손목 상대 도달 높이',primaryValue:best?'t'+best.height.integer:'미검출',primaryUnit:'',tRaw:best?.height.raw??null,tInteger:best?.height.integer??null,divisions:options.birDivisions??10,trackingPoint:'wrist',trackedPoint:'손목',reachIndex:best?best.height.raw/(options.birDivisions??10)*100:null,maxReachFrameIndex:best?.index??null,minElbowAngle:elbow?.elbow??null,minElbowFrameIndex:elbow?.index??null,representativeFrameIndex:best?.index??0,secondaryLabel:'골반 t0 → 어깨 t'+(options.birDivisions??10)+' · 손목 기준 · 척추 번호 아님'};
    }
    const reaches=frames.map((f,index)=> {
      const s=f.corrected[arm+'_shoulder'],h=f.corrected[arm+'_hip'],p=trackedHandPoint(f.corrected,arm,'bir',options.birTrackingPoint||'auto');
      if(!usable(s)||!usable(h)||!p||h.y-s.y<.05)return null;
      return {index,value:(h.y-p.y)/(h.y-s.y),source:p.source};
    }).filter(Boolean);
    const best=reaches.reduce((a,b)=>!a||b.value>a.value?b:a,null);
    const elbows=frames.map((f,index)=>({index,value:elbowAngles(f.corrected)[arm]})).filter(r=>Number.isFinite(r.value));
    const elbow=elbows.reduce((a,b)=>!a||b.value<a.value?b:a,null);
    const autoLevel=best?reachLevel(best.value):null,level=options.birManualSpineLevel||autoLevel;
    if(!best&&!elbow)return null;
    return {...base,valid:!!best,representativeFrameIndex:best?.index??elbow?.index,primaryLabel:'척추 도달 레벨 (추정)',primaryValue:level??'미검출',primaryUnit:'',autoSpineLevel:autoLevel,manualSpineLevel:options.birManualSpineLevel||null,finalSpineLevel:level,reachIndex:best?+(best.value*100).toFixed(1):null,maxReachFrameIndex:best?.index??null,minElbowAngle:elbow?.value??null,minElbowFrameIndex:elbow?.index??null,trackedPoint:best?.source??'미검출',secondaryLabel:`자동 ${autoLevel??'—'} · 확정 ${options.birManualSpineLevel||'미확정'} · ${best?.source??'미검출'} · 척추 번호는 추정치`};
  }
  if(motion==='CIR') {
    const automatic=detectCirRange(frames,arm,options),start=options.cirStartFrame??automatic.startFrameIndex,end=options.cirEndFrame??automatic.endFrameIndex;
    const all=cirTrack(frames,arm,options),rangeValid=Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end<frames.length&&end>start;
    const rows=rangeValid?all.slice(start,end+1):[],metrics=circleMetrics(rows.map(r=>r.relative));
    const counts=Object.fromEntries(['detected','manual','interpolated','missing'].map(s=>[s,rows.filter(r=>r.status===s).length]));
    const detection=rows.length?counts.detected/rows.length*100:0;
    const missing=rows.filter(r=>!r.relative).length;
    const valid=rangeValid&&metrics.valid&&missing===0;
    const reason=!rangeValid?automatic.reason||'시작·종료 구간을 확인하세요.':!metrics.valid?metrics.reason:missing?'긴 미검출 구간이 있어 연속 회전을 확정할 수 없습니다.':detection<70?'직접 검출률이 낮습니다. 수동 확인이 필요합니다.':'영상 기반 지표 · 임상 정상/비정상 판정 아님';
    const best=metrics.center?rows.filter(r=>r.relative).reduce((a,b)=>!a||Math.abs(Math.hypot(b.relative.x-metrics.center.x,b.relative.y-metrics.center.y)-metrics.meanRadius)>Math.abs(Math.hypot(a.relative.x-metrics.center.x,a.relative.y-metrics.center.y)-metrics.meanRadius)?b:a,null):null;
    return {...base,...metrics,valid,primaryLabel:'손끝 궤적 진원도',primaryValue:valid?+metrics.circularity.toFixed(1):'판정 보류',primaryUnit:valid?'%':'',trackedPoint:'엄지손가락',automaticStartFrameIndex:automatic.startFrameIndex,automaticEndFrameIndex:automatic.endFrameIndex,startFrameIndex:start,endFrameIndex:end,representativeFrameIndex:best?.index??start??null,handDetectionRate:detection,trackingCounts:counts,wristFallbackFrames:0,interpolationPolicy:{maxFrames:options.gapFrames??5,maxSeconds:options.gapSeconds??.2},endReason:automatic.reason,confidence:valid&&detection>=70?'검토 가능':'낮음',secondaryLabel:reason};
  }
  return angles.length?base:null;
}
export function validateAnalysis({frames=[],expectedFrames=0,rom=null,motion='AB',target=null,tolerance=null}) {
  const actual=motion==='BIR'?rom?.reachIndex:motion==='CIR'?rom?.circularity:rom?.rom;
  const hasTarget=target!==''&&target!=null&&tolerance!==''&&tolerance!=null&&Number.isFinite(Number(target))&&Number.isFinite(Number(tolerance));
  const framePass=expectedFrames>0&&frames.length===expectedFrames;
  const metricPass=hasTarget&&rom?.valid&&Number.isFinite(actual)?Math.abs(actual-Number(target))<=Number(tolerance):null;
  return {expectedFrames,processedFrames:frames.length,missingFrames:Math.max(0,expectedFrames-frames.length),coverage:expectedFrames?+(frames.length/expectedFrames*100).toFixed(1):0,actual:actual??null,target:hasTarget?Number(target):null,tolerance:hasTarget?Number(tolerance):null,framePass,metricPass,passed:metricPass===null?null:framePass&&metricPass};
}
export function auditFields(item,arm,motion) {
  const sf=i=>Number.isInteger(i)?item.frames[i]?.sourceFrame??i:null, tm=i=>Number.isInteger(i)?item.frames[i]?.time??null:null;
  const r=item.rom,a=item.autoRom;
  return {measuredArm:arm,hideOppositeArm:['FE','ER','CIR'].includes(motion),displayMeasuredArmOnly:false,displayTrunk:true,frameNumberBase:0,
    autoRepresentativeSourceFrame:sf(item.autoRepresentativeFrame),manualRepresentativeSourceFrame:sf(item.manualRepresentativeFrame),finalRepresentativeSourceFrame:sf(item.finalRepresentativeFrame),representativeTime:tm(item.finalRepresentativeFrame),representativeSelectionType:item.representativeSelectionType,
    autoAnalysis:a??null,correctedAnalysis:r??null,finalAnalysis:r??null,
    cirManualStartSourceFrame:sf(item.cirManualStartFrame),cirManualEndSourceFrame:sf(item.cirManualEndFrame),
    birSpineLevel:motion==='BIR'?r?.finalSpineLevel:null,birAutoSpineLevel:motion==='BIR'?a?.autoSpineLevel:null,birManualSpineLevel:item.birManualSpineLevel??null,birReachIndex:r?.reachIndex??null,birTrackingPoint:r?.trackedPoint??null,birMinElbowAngle:r?.minElbowAngle??null,birMinElbowFrame:sf(r?.minElbowFrameIndex),birMinElbowTime:tm(r?.minElbowFrameIndex),birMaxReachFrame:sf(r?.maxReachFrameIndex),birMaxReachTime:tm(r?.maxReachFrameIndex),
    cirStartFrame:sf(r?.startFrameIndex),cirEndFrame:sf(r?.endFrameIndex),cirAutoStartFrame:sf(a?.automaticStartFrameIndex),cirAutoEndFrame:sf(a?.automaticEndFrameIndex),cirManualStartFrame:sf(item.cirManualStartFrame),cirManualEndFrame:sf(item.cirManualEndFrame),cirTrackingPoint:motion==='CIR'?'thumb_tip':null,cirCircularity:r?.circularity??null,cirCoverageDegrees:r?.coverageDegrees??null,cirClosureError:r?.closureError??null,cirWobbleIndex:r?.wobbleIndex??null,cirDirection:r?.direction??null,cirTrackingCounts:r?.trackingCounts??null,cirWristFallbackFrames:motion==='CIR'?0:null,stillImageSourceFrame:item.stillImageSourceFrame??null,stillImageTime:item.stillImageTime??null,stillImageDecodeTime:item.stillImageDecodeTime??null,policyVersion:POLICY.version};
}
export function framesToCsv(frames,patient={},item={}) {
  const audit=auditFields({...item,frames},patient.arm,frames[0]?.motion), keys=Object.keys(audit);
  const track=frames[0]?.motion==='CIR'?cirTrack(frames,patient.arm,item):[];
  const rows=[['patient_id','measured_arm','analysis_index','source_frame_0based','time_sec','motion','landmark','raw_x','raw_y','corrected_x','corrected_y','raw_visibility','corrected_status','edited','thumb_tracking_status',...keys]];
  for(const f of frames)for(const {id}of LANDMARKS){const r=f.raw[id],c=f.corrected[id];rows.push([patient.id,patient.arm,f.index,f.sourceFrame??f.index,f.time,f.motion,id,r.x,r.y,c.x,c.y,r.visibility,c.status??(usable(c)?'detected':'missing'),isEdited(r,c),track[f.index]?.status??'',...keys.map(k=>typeof audit[k]==='object'&&audit[k]!==null?JSON.stringify(audit[k]):audit[k])]);}
  return rows.map(row=>row.map(value=>{let s=String(value??'');if(/^[=+@\t\r]/.test(s)||/^-[^\d.]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\n');
}
