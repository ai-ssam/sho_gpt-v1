import {angleAt} from './geometry.mjs';

export const DEFAULT_CAPTURE={startSeconds:1.5,returnSeconds:1.2};
export function validateCapture(c){
 if(!c||![c.startSeconds,c.returnSeconds].every(v=>Number.isFinite(v)&&v>0&&v<=60))throw Error('중립 유지시간은 0초 초과 60초 이하로 입력하세요.');
 return c;
}
export function postureFeatures(points,arm){
 const s=points?.[arm+'_shoulder'],e=points?.[arm+'_elbow'],w=points?.[arm+'_wrist'],h=points?.[arm+'_hip'];
 if([s,e,w,h].some(p=>!p||![p.x,p.y].every(Number.isFinite)||(p.status!=='manual'&&(p.visibility??0)<.45)))return null;
 const aspect=s.aspectRatio||1,length=Math.hypot((s.x-h.x)*aspect,s.y-h.y);
 if(length<.05)return null;
 const result={shoulder:angleAt(e,s,h),elbow:angleAt(s,e,w),wristX:(w.x-s.x)*aspect/length,wristY:(w.y-s.y)/length};
 return Object.values(result).every(Number.isFinite)?result:null;
}
export function templatePose(points,arm,template){
 const f=postureFeatures(points,arm),t=template?.features;
 if(!f||!t||template.arm!==arm)return {valid:false};
 const angles=Math.max(Math.abs(f.shoulder-t.shoulder),Math.abs(f.elbow-t.elbow));
 const position=Math.hypot(f.wristX-t.wristX,f.wristY-t.wristY);
 const neutral=angles<=template.angleTolerance&&position<=template.positionTolerance;
 return {valid:true,neutral,excursion:angles>template.angleTolerance*1.5||position>template.positionTolerance*1.5};
}
export function makeTemplate({motion,arm,view,image,raw,corrected,source,angleTolerance=15,positionTolerance=.2}){
 if(!['left','right'].includes(arm)||!motion||!image?.startsWith('data:image/jpeg'))throw Error('동작·팔·기준 이미지를 확인하세요.');
 if(!(Number.isFinite(angleTolerance)&&angleTolerance>0&&angleTolerance<=60&&Number.isFinite(positionTolerance)&&positionTolerance>0&&positionTolerance<=1))throw Error('각도 허용값은 0~60°, 위치 허용값은 0~1(각각 0 제외)로 입력하세요.');
 const features=postureFeatures(corrected,arm);if(!features)throw Error('측정 팔 어깨·팔꿈치·손목·골반 관절점을 확인·수정하세요.');
 return {id:crypto.randomUUID(),version:'neutral-'+new Date().toISOString(),createdAt:new Date().toISOString(),motion,arm,view,image,raw:structuredClone(raw),corrected:structuredClone(corrected),source:structuredClone(source),features,angleTolerance,positionTolerance};
}
export async function templateStore(action,value){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('shoulder-rom-neutral-v52',1);r.onupgradeneeded=()=>r.result.createObjectStore('templates',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('templates',action==='save'?'readwrite':'readonly'),store=tx.objectStore('templates');
  const request=action==='save'?store.add(value):store.getAll();let result;
  request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||request.error);tx.onabort=()=>reject(tx.error||Error('기준 저장이 취소되었습니다.'));
 });}finally{db.close();}
}
