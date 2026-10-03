import { angleAt } from './geometry.mjs';
export const ACTIVE_MOTIONS=['AB','FE','ER','BIR','IRER'];
export const DEFAULT_CRITERIA={version:'sample-0.1.0',label:'동작 의심도점수',weights:{AB:25,FE:25,ER:10,BIR:15,IRER:25},thresholds:{AB:[150,120,90],FE:[150,120,90],ER:[40,30,20],IRER:[60,40,20]},bir:[['T1','T2','T3','T4','T5','T6','T7','above_T1'],['T8','T9','T10','T11','T12'],['L1','L2','L3','L4','L5'],['천골','sacrum','buttock_or_below','unable_to_reach_behind_back']]};
export function validateCriteria(c){
 if(!c||c.label!=='동작 의심도점수'||!c.version)throw Error('기준 이름과 버전을 확인하세요.');
 if(ACTIVE_MOTIONS.some(k=>!Number.isFinite(c.weights?.[k])||c.weights[k]<0)||Math.abs(ACTIVE_MOTIONS.reduce((s,k)=>s+c.weights[k],0)-100)>.00001)throw Error('가중치 합계는 100이어야 합니다.');
 for(const k of ['AB','FE','ER','IRER']){const t=c.thresholds?.[k];if(!Array.isArray(t)||t.length!==3||!t.every(Number.isFinite)||!(t[0]>t[1]&&t[1]>t[2]&&t[2]>=0))throw Error(k+' 경계값은 큰 값부터 3개를 입력하세요.');}
 if(!Array.isArray(c.bir)||c.bir.length!==4||c.bir.some(a=>!Array.isArray(a)||!a.length||a.some(x=>typeof x!=='string'||!x.trim())))throw Error('BIR 범주는 4개 구간이 필요합니다.');
 const values=c.bir.flat();if(new Set(values).size!==values.length)throw Error('BIR 범주가 중복되었습니다.');
 return c;
}
export function evaluate(sessions,c=DEFAULT_CRITERIA){
 validateCriteria(c);
 const rows=ACTIVE_MOTIONS.map(code=>{
  const s=sessions[code],r=s?.rom;let score=null,value=null,reason='';
  if(!r?.valid||['queued','analyzing','error','cancelled'].includes(s.analysisStatus))reason='분석 미완료';
  else if(code==='BIR'){value=s.birManualSpineLevel;if(!value)reason='척추 수준 확인 필요';else{score=c.bir.findIndex(a=>a.includes(value));if(score<0){score=null;reason='미등록 척추 수준';}}}
  else if(code==='IRER'&&!s.measurementConfirmed)reason='3D 추정값 확인 필요';
  else{value=r.maxAngle;if(Number.isFinite(value)&&value>=0&&value<=180)score=c.thresholds[code].filter(t=>value<t).length;else reason='유효 각도 없음';}
  return {code,value,score,reason,weight:c.weights[code]};
 });
 const valid=rows.every(r=>r.score!==null);
 const total=valid?rows.reduce((s,r)=>s+r.score/3*r.weight,0):null;
 return {label:c.label,total,stage:total===null?'평가 보류':total<20?'움직임 제한 적음':total<50?'움직임 제한 주의':'움직임 제한 큼',rows,criteria:structuredClone(c),clinicalValidation:false};
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
 constructor(){this.reset();}
 reset(){this.phase='waiting';this.since=null;this.moved=false;}
 update({valid,neutral,excursion},now,recording){
  if(!valid){this.since=null;return null;}
  if(!recording){
   if(this.phase==='done')return null;
   if(!neutral){this.since=null;return null;}
   this.since??=now;
   if(now-this.since>=1500){this.phase='starting';this.since=null;return 'start';}
  }else{
   if(excursion){this.moved=true;this.since=null;}
   if(this.moved&&neutral){this.since??=now;if(now-this.since>=1200){this.phase='done';return 'stop';}}
   else this.since=null;
  }
  return null;
 }
}
export function poseState(points,world,arm,motion){
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
