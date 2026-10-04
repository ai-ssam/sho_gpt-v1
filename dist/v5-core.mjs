import { angleAt } from './geometry.mjs';
import {signedElevation} from './motion-metrics.mjs';
export const ACTIVE_MOTIONS=['AB','FE2','BIR','IRER','FE','ER','CIR'];
export const DEFAULT_MOTIONS=['AB','FE2','BIR','IRER'];
export const DEFAULT_CRITERIA={version:'sample-v52-full-1',label:'동작 의심도점수',activeMotions:[...DEFAULT_MOTIONS],birDivisions:10,birMode:'relative-t',weights:{AB:25,FE2:35,BIR:15,IRER:25,FE:0,ER:0,CIR:0},thresholds:{AB:[150,120,90],FE2:[200,160,120],BIR:[8,5,2],FE:[150,120,90],ER:[40,30,20],IRER:[60,40,20],CIR:[90,75,50]},bir:[['T1','T2','T3','T4','T5','T6','T7','above_T1'],['T8','T9','T10','T11','T12'],['L1','L2','L3','L4','L5'],['천골','sacrum','buttock_or_below','unable_to_reach_behind_back']]};
export const activeMotions=c=>c?.activeMotions??['AB','FE','ER','BIR','IRER'];
export function validateCriteria(c){
 if(!c||c.label!=='동작 의심도점수'||!c.version)throw Error('기준 이름과 버전을 확인하세요.');
 const motions=activeMotions(c);
 if(!Array.isArray(motions)||!motions.length||new Set(motions).size!==motions.length||motions.some(k=>!ACTIVE_MOTIONS.includes(k)))throw Error('활성 동작 목록을 확인하세요.');
 if(motions.some(k=>!Number.isFinite(c.weights?.[k])||c.weights[k]<0)||Math.abs(motions.reduce((s,k)=>s+c.weights[k],0)-100)>.00001)throw Error('활성 동작 가중치 합계는 100이어야 합니다.');
 for(const k of motions.filter(k=>k!=='BIR'||c.birMode==='relative-t')){const t=c.thresholds?.[k];if(!Array.isArray(t)||t.length!==3||!t.every(Number.isFinite)||!(t[0]>t[1]&&t[1]>t[2])||(k!=='BIR'&&t[2]<0))throw Error(k+' 경계값은 큰 값부터 3개를 입력하세요.');}
 if(c.birMode==='relative-t'&&(!Number.isInteger(c.birDivisions)||c.birDivisions<1||c.birDivisions>100))throw Error('BIR 분할 수는 1~100 정수입니다.');
 if(!Array.isArray(c.bir)||c.bir.length!==4||c.bir.some(a=>!Array.isArray(a)||!a.length||a.some(x=>typeof x!=='string'||!x.trim())))throw Error('BIR 범주는 4개 구간이 필요합니다.');
 const values=c.bir.flat();if(new Set(values).size!==values.length)throw Error('BIR 범주가 중복되었습니다.');
 if(c.stages!==undefined)validateStages(c.stages);
 return c;
}
export function evaluate(sessions,c=DEFAULT_CRITERIA){
 validateCriteria(c);
 const rows=activeMotions(c).map(code=>{
  const s=sessions[code],r=s?.rom;let score=null,value=null,reason='';
  if(!r?.valid||['queued','analyzing','error','cancelled'].includes(s.analysisStatus))reason='분석 미완료';
  else if(code==='BIR'&&c.birMode!=='relative-t'){value=s.birManualSpineLevel;if(!value)reason='척추 수준 확인 필요';else{score=c.bir.findIndex(a=>a.includes(value));if(score<0){score=null;reason='미등록 척추 수준';}}}
  else if(code==='BIR'){value=r.tRaw;if(r.divisions!==c.birDivisions)reason='BIR 분할 수 변경 · 재계산 필요';else if(Number.isFinite(value))score=c.thresholds.BIR.filter(t=>value<t).length;else reason='t구간 재분석 필요';}
  else if(code==='IRER'&&!s.measurementConfirmed)reason='3D 추정값 확인 필요';
  else{value=code==='FE2'?r.rom:code==='CIR'?r.circularity:r.maxAngle;if(Number.isFinite(value)&&value>=0&&value<=(code==='FE2'?360:180))score=c.thresholds[code].filter(t=>value<t).length;else reason='유효 측정값 없음';}
  return {code,value,score,reason,weight:c.weights[code]};
 });
 const valid=rows.every(r=>r.score!==null);
 const total=valid?rows.reduce((s,r)=>s+r.score/3*r.weight,0):null;
 const stage=classifyScore(total,c.stages);
 return {label:c.label,total,stage:stage.label,stageColor:stage.color,rows,criteria:structuredClone(c),clinicalValidation:false};
}
export const DEFAULT_STAGES={boundaries:[20,50],labels:['제한 적음','경도','중증도']};
export function validateStages(stages){
 const b=stages?.boundaries,l=stages?.labels;
 if(!Array.isArray(b)||b.length!==2||!b.every(Number.isFinite)||!(0<b[0]&&b[0]<b[1]&&b[1]<100))throw Error('3단계 경계는 0 < 첫 경계 < 둘째 경계 < 100이어야 합니다.');
 if(!Array.isArray(l)||l.length!==3||l.some(x=>typeof x!=='string'||!x.trim()||x.length>30))throw Error('3단계 문구를 각각 1~30자로 입력하세요.');
 return stages;
}
export function classifyScore(total,stages=DEFAULT_STAGES){
 validateStages(stages);
 if(!Number.isFinite(total)||total<0||total>100)return {label:'평가 보류',color:'pending'};
 const i=total<stages.boundaries[0]?0:total<stages.boundaries[1]?1:2;
 return {label:stages.labels[i],color:['green','yellow','red'][i]};
}
const sub=(a,b)=>[a.x-b.x,a.y-b.y,a.z-b.z];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=a=>Math.hypot(...a);
const unit=a=>{const n=norm(a);return n>1e-6?a.map(v=>v/n):null;};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function externalRotation(world,arm){
 if(!world)return null;
 const names=['left_shoulder','right_shoulder','left_hip','right_hip',arm+'_elbow',arm+'_wrist'];
 if(names.some(k=>!world[k]||![world[k].x,world[k].y,world[k].z].every(Number.isFinite)||(world[k].visibility??1)<.45))return null;
 const p=world,mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2});
 const down=unit(sub(mid(p.left_hip,p.right_hip),mid(p.left_shoulder,p.right_shoulder)));
 if(!down)return null;
 const lateral=sub(p.right_shoulder,p.left_shoulder),right=unit(lateral.map((v,i)=>v-dot(lateral,down)*down[i]));
 if(!right)return null;
 const forward=unit(cross(right,down)),fore=sub(p[arm+'_wrist'],p[arm+'_elbow']);
 const flat=fore.map((v,i)=>v-dot(fore,down)*down[i]);
 const outward=right.map(v=>v*(arm==='right'?1:-1));
 if(norm(flat)<.02||dot(flat,forward)<=0)return null;
 const upper=sub(p[arm+'_elbow'],p[arm+'_shoulder']);
 const bend=Math.acos(Math.max(-1,Math.min(1,-dot(upper,fore)/(norm(upper)*norm(fore)))))*180/Math.PI;
 const upperTilt=Math.acos(Math.max(-1,Math.min(1,dot(upper,down)/norm(upper))))*180/Math.PI;
 if(!Number.isFinite(bend)||bend<65||bend>115||upperTilt>30)return null;
 const angle=Math.atan2(dot(flat,outward),dot(flat,forward))*180/Math.PI;
 return angle>=-10&&angle<=100?Math.max(0,angle):null;
}
export class AutoCapture {
 constructor(options={}){this.configure(options);this.reset();}
 configure({startSeconds=1.5,returnSeconds=1.2}={}){
  if(![startSeconds,returnSeconds].every(v=>Number.isFinite(v)&&v>0&&v<=60))throw Error('중립 유지시간은 0초 초과 60초 이하로 입력하세요.');
  this.startMs=startSeconds*1000;this.returnMs=returnSeconds*1000;this.reset();
 }
 reset(){this.phase='waiting';this.since=null;this.moved=false;this.extended=false;this.flexed=false;}
 update({valid,neutral,excursion,motion,extension,flexion},now,recording){
  if(!valid){this.since=null;return null;}
  if(!recording){
   if(this.phase==='done')return null;
   if(!neutral){this.since=null;return null;}
   this.since??=now;
   if(now-this.since>=this.startMs){this.phase='starting';this.since=null;return 'start';}
  }else{
   if(excursion){this.moved=true;this.since=null;}
   if(motion==='FE2'){if(extension)this.extended=true;if(this.extended&&flexion)this.flexed=true;if(!this.flexed){this.since=null;return null;}}
   if(this.moved&&neutral){this.since??=now;if(now-this.since>=this.returnMs){this.phase='done';return 'stop';}}
   else this.since=null;
  }
  return null;
 }
}
export function poseState(points,world,arm,motion,facing='right'){
 if(motion==='FE2'){const a=signedElevation(points,arm,facing);return {valid:a!==null,neutral:a!==null&&Math.abs(a)<15,excursion:a!==null&&Math.abs(a)>25,motion,extension:a!==null&&a< -10,flexion:a!==null&&a>30};}
 if(motion==='IRER'){const a=externalRotation(world,arm);return {valid:a!==null,neutral:a!==null&&a<12,excursion:a!==null&&a>20};}
 const s=points?.[arm+'_shoulder'],e=points?.[arm+'_elbow'],w=points?.[arm+'_wrist'],h=points?.[arm+'_hip'];
 if([s,e,w,h].some(p=>!p||(p.visibility??0)<.6))return {valid:false};
 const angle=angleAt(e,s,h),bend=angleAt(s,e,w),length=Math.hypot(s.x-h.x,s.y-h.y);
 if(!Number.isFinite(angle)||!Number.isFinite(bend)||length<.08)return {valid:false};
 if(motion==='IRER'){const a=externalRotation(world,arm);return {valid:a!==null,neutral:a!==null&&a<12,excursion:a!==null&&a>20};}
 return {valid:true,neutral:angle<18&&bend>145,excursion:motion==='BIR'?bend<110||w.y<h.y-.15*length:angle>30};
}
export function mergeRefinement(original,refined){
 const map=new Map(original.map(f=>[f.sourceFrame,f]));
 for(const fresh of refined){const old=map.get(fresh.sourceFrame);if(old){for(const [id,p]of Object.entries(old.corrected)){if(p.status==='manual'||Math.abs(p.x-old.raw[id].x)>.0005||Math.abs(p.y-old.raw[id].y)>.0005)fresh.corrected[id]={...p};}fresh.phase=old.phase;fresh.worldCorrected=old.worldCorrected??fresh.worldCorrected;}
 map.set(fresh.sourceFrame,fresh);}
 return [...map.values()].sort((a,b)=>a.time-b.time).map((f,index)=>({...f,index}));
}
