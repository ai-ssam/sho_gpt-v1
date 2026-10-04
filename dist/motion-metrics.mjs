const good=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.status==='manual'||(p.visibility??0)>=.45);
const distance=(a,b,aspect=1)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
export function signedElevation(points,arm,facing='right'){
 const s=points?.[arm+'_shoulder'],e=points?.[arm+'_elbow'],h=points?.[arm+'_hip'];
 if(![s,e,h].every(good))return null;
 const a=s.aspectRatio||1,ux=(e.x-s.x)*a,uy=e.y-s.y,dx=(h.x-s.x)*a,dy=h.y-s.y;
 if(Math.hypot(ux,uy)<.02||Math.hypot(dx,dy)<.05)return null;
 return Math.atan2((ux*dy-uy*dx)*(facing==='left'?-1:1),ux*dx+uy*dy)*180/Math.PI;
}
export function fe2Metrics(frames,arm,{facing='right',fe2ExtensionFrame=null,fe2FlexionFrame=null}={}){
 const rows=[];let previous=null;
 for(let index=0;index<frames.length;index++){
  let value=signedElevation(frames[index].corrected,arm,facing);if(value===null)continue;
  if(previous!==null){while(value-previous>180)value-=360;while(value-previous< -180)value+=360;}
  previous=value;if(value< -120||value>240)continue;rows.push({index,value});
 }
 if(!rows.length)return {valid:false,primaryLabel:'FE2 전체 가동범위',primaryValue:'검토 필요',primaryUnit:'',secondaryLabel:'유효 관절점 부족',representativeFrameIndex:0};
 const automaticExtension=rows.reduce((a,b)=>a.value<b.value?a:b),automaticFlexion=rows.reduce((a,b)=>a.value>b.value?a:b);
 const extension=Number.isInteger(fe2ExtensionFrame)?rows.find(r=>r.index===fe2ExtensionFrame):automaticExtension;
 const flexion=Number.isInteger(fe2FlexionFrame)?rows.find(r=>r.index===fe2FlexionFrame):automaticFlexion;
 const valid=!!extension&&!!flexion&&extension.value< -2&&flexion.value>2&&extension.index<flexion.index;
 const rom=extension&&flexion?flexion.value-extension.value:null;
 return {valid,rom,minAngle:extension?.value??null,maxAngle:flexion?.value??null,minFrameIndex:extension?.index,maxFrameIndex:flexion?.index,extensionFrameIndex:extension?.index,flexionFrameIndex:flexion?.index,automaticExtensionFrame:automaticExtension.index,automaticFlexionFrame:automaticFlexion.index,representativeFrameIndex:flexion?.index??0,primaryLabel:'FE2 전체 가동범위',primaryValue:valid?+rom.toFixed(1):'양 극점 확인',primaryUnit:valid?'°':'',secondaryLabel:valid?`신전 ${Math.abs(extension.value).toFixed(1)}° + 굴곡 ${flexion.value.toFixed(1)}° · 방향 ${facing==='right'?'화면 오른쪽':'화면 왼쪽'}`:'뒤쪽 신전 → 앞쪽 굴곡 순서와 촬영 방향을 확인하세요.',validFrames:rows.length,facing};
}
export function birHeight(points,arm,divisions=10){
 const wrist=points?.[arm+'_wrist'],ls=points?.left_shoulder,rs=points?.right_shoulder,lh=points?.left_hip,rh=points?.right_hip;
 if(![wrist,ls,rs,lh,rh].every(good)||!Number.isInteger(divisions)||divisions<1||divisions>100)return null;
 const line=(a,b)=>Math.abs(b.x-a.x)>.03?a.y+(b.y-a.y)*(wrist.x-a.x)/(b.x-a.x):(a.y+b.y)/2;
 const shoulderY=line(ls,rs),pelvisY=line(lh,rh);if(pelvisY-shoulderY<.05)return null;
 const raw=divisions*(pelvisY-wrist.y)/(pelvisY-shoulderY);
 // Half away from zero, including negative levels; never display negative zero.
 const integer=Math.sign(raw)*Math.floor(Math.abs(raw)+.5)||0;
 return {raw,integer,divisions,shoulderY,pelvisY,trackingPoint:'wrist'};
}
export function calibrateIRER(points,arm,reference='wrist'){
 const other=arm==='right'?'left':'right',s=points?.[other+'_shoulder'],e=points?.[other+'_elbow'],elbow=points?.[arm+'_elbow'],hand=points?.[arm+'_'+(reference==='fist'?'hand_tip':'wrist')];
 if(![s,e,elbow,hand].every(good))throw Error('반대 팔 어깨·팔꿈치와 측정 팔 팔꿈치·손 기준점을 확인하세요.');
 const aspect=s.aspectRatio||1,upper=distance(s,e,aspect),forearm=distance(elbow,hand,aspect);
 if(upper<.04||forearm<.04)throw Error('보정 길이가 너무 짧습니다. 전완을 영상면과 평행하게 펼치세요.');
 return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),arm,reference,forearm,oppositeUpper:upper,shoulderWidth:good(points[arm+'_shoulder'])?distance(s,points[arm+'_shoulder'],aspect):null,aspectRatio:aspect,rawPoints:structuredClone(points),method:'plane-parallel-length',clinicalValidation:false};
}
export function irerAuxiliary(points,arm,calibration,worldAngle,options={}){
 const warnings=[],tolerance=options.maxDifference??15,scaleTolerance=options.scaleTolerance??.25;
 if(!calibration||calibration.arm!==arm)return {angle:null,warnings:['개인 전완 길이 보정 필요'],quality:'보정 없음'};
 const other=arm==='right'?'left':'right',s=points?.[other+'_shoulder'],e=points?.[other+'_elbow'],ms=points?.[arm+'_shoulder'],me=points?.[arm+'_elbow'],w=points?.[arm+'_'+(calibration.reference==='fist'?'hand_tip':'wrist')],hip=points?.[arm+'_hip'];
 if(![s,e,ms,me,w,hip].every(good))return {angle:null,warnings:['손/팔/몸통 관절점 검출 부족'],quality:'확인 필요'};
 const aspect=s.aspectRatio||1,scale=distance(s,e,aspect)/calibration.oppositeUpper,length=calibration.forearm*scale;
 const torso=distance(ms,hip,aspect),outward=Math.sign(ms.x-s.x);
 if(!Number.isFinite(length)||length<.02||!outward)return {angle:null,warnings:['보정 길이·정면 자세 오류'],quality:'확인 필요'};
 const ratio=(w.x-me.x)*aspect*outward/length;
 if(Math.abs(scale-1)>scaleTolerance)warnings.push('보정 시점 대비 촬영 거리 변화');
 if(calibration.shoulderWidth&&Math.abs(distance(ms,s,aspect)/(calibration.shoulderWidth*scale)-1)>.2)warnings.push('몸통 회전·정면 촬영 확인');
 if(ratio< -.1||ratio>1.05)warnings.push('손 이동량이 보정 범위를 벗어남');
 if(Math.abs(me.x-ms.x)*aspect>torso*.25)warnings.push('팔꿈치 몸통 이탈');
 if(Math.abs(w.y-me.y)>length*.25)warnings.push('전완 수평/팔꿈치 90° 확인');
 if(Math.abs(ms.y-s.y)>torso*.15)warnings.push('어깨 들림·몸통 기울기');
 const angle=Math.asin(Math.max(0,Math.min(1,ratio)))*180/Math.PI;
 const difference=Number.isFinite(worldAngle)?Math.abs(worldAngle-angle):null;
 if(difference===null)warnings.push('3D 추정값 없음');else if(difference>tolerance)warnings.push('3D·길이 추정 불일치');
 return {angle,difference,scale,warnings,quality:warnings.length?'확인 필요':'비교 가능',reference:calibration.reference,method:'asin-lateral-displacement',inferredPoint:{...w,status:'estimated',source:'length-model',zEstimate:length*Math.cos(angle*Math.PI/180)}};
}
