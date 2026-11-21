import {irer2D} from './motion-metrics.mjs?v=5.2.0-irer2d';
import {externalRotation} from './v5-core.mjs?v=5.2.0-irer2d';

export const IRER_METHODS={ '2d':'irer-2d-asin-v1','3d':'irer-3d-legacy-v1' };
export function normalizeIRER(options={}){
 const mode=options.mode??'2d',primary=options.primary??'2d';
 if(!['2d','3d','compare'].includes(mode)||!['2d','3d'].includes(primary))throw Error('IRER 계산 방식/주 계산을 확인하세요.');
 return {...options,mode,primary:mode==='compare'?primary:mode};
}
export function sessionIRER(item={}){
 const legacy=!item.irerOptions?.mode&&/3D/.test(item.rom?.primaryLabel??'');
 return normalizeIRER({...item.irerOptions,...(legacy?{mode:'3d',primary:'3d'}:{})});
}
export function legacy3D(world,arm){
 const names=['left_shoulder','right_shoulder','left_hip','right_hip',arm+'_elbow',arm+'_wrist'];
 if(!world)return {angle:null,valid:false,warnings:['3D 좌표 없음 · 원본 영상 재분석 필요'],method:IRER_METHODS['3d'],requiresReanalysis:true};
 const missing=names.filter(k=>!world[k]||![world[k].x,world[k].y,world[k].z].every(Number.isFinite)||(world[k].visibility??1)<.45);
 const angle=externalRotation(world,arm);
 return {angle,valid:Number.isFinite(angle),warnings:missing.length?['3D 관절점/신뢰도 부족: '+missing.join(', ')]:angle===null?['기존 3D 자세/방향 조건 탈락 · 팔꿈치 65~115°, 상완 기울기 ≤30°, 전완 앞쪽 성분 >0 확인 (90° 근처 제외 가능)']:[],method:IRER_METHODS['3d'],quality:angle===null?'확인 필요':'3D 자세 조건 통과'};
}
export function irerFrame(frame,arm,options={},calibration=null){
 const settings=normalizeIRER(options);
 const two=settings.mode!=='3d'?irer2D(frame?.corrected,arm,calibration,settings):null;
 const three=settings.mode!=='2d'?legacy3D(frame?.worldCorrected??frame?.worldRaw,arm):null;
 const selected=settings.primary==='2d'?two:three;
 return {...selected,settings,primary:settings.primary,mode:settings.mode,two,three,difference:two?.valid&&three?.valid?Math.abs(two.angle-three.angle):null};
}
export function irerSummary(frames,arm,options={},calibration=null){
 const settings=normalizeIRER(options),diagnostics=frames.map((f,index)=>({index,time:f.time,sourceFrame:f.sourceFrame??index,...irerFrame(f,arm,settings,calibration)}));
 const rows=diagnostics.filter(r=>Number.isFinite(r.angle));
 const peak=key=>{const valid=diagnostics.filter(r=>Number.isFinite(r[key]?.angle));if(!valid.length)return null;const r=valid.reduce((a,b)=>a[key].angle>=b[key].angle?a:b);return {angle:r[key].angle,index:r.index,time:r.time,sourceFrame:r.sourceFrame};};
 const comparison=settings.mode==='compare'?{twoMax:peak('two'),threeMax:peak('three'),sameFrame:diagnostics.map(r=>({index:r.index,time:r.time,sourceFrame:r.sourceFrame,two:r.two?.angle??null,three:r.three?.angle??null,difference:r.difference,reasons2D:r.two?.warnings??[],reasons3D:r.three?.warnings??[]}))}:null;
 const label=settings.primary==='2d'?'2D 길이비':'기존 3D 추정';
 const common={method:IRER_METHODS[settings.primary],mode:settings.mode,primary:settings.primary,algorithmVersions:IRER_METHODS,diagnostics,comparison,validFrames:rows.length,calibration:calibration??null,requiresReanalysis:diagnostics.some(r=>r.requiresReanalysis||r.three?.requiresReanalysis)};
 if(!rows.length)return {...common,valid:false,rom:null,minAngle:null,maxAngle:null,minFrameIndex:null,maxFrameIndex:null,primaryLabel:'외회전각 ('+label+')',primaryValue:'확인 필요',primaryUnit:'',secondaryLabel:[...new Set(diagnostics.flatMap(r=>r.warnings??[]))].join(' / '),representativeFrameIndex:0};
 const lo=rows.reduce((a,b)=>a.angle<=b.angle?a:b),hi=rows.reduce((a,b)=>a.angle>=b.angle?a:b);
 return {...common,valid:true,rom:hi.angle-lo.angle,minAngle:lo.angle,maxAngle:hi.angle,minFrameIndex:lo.index,maxFrameIndex:hi.index,representativeFrameIndex:hi.index,primaryLabel:'최대 외회전각 ('+label+')',primaryValue:+hi.angle.toFixed(1),primaryUnit:'°',secondaryLabel:label+' · '+(hi.warnings?.join(' / ')||'자세 조건 통과'),auxiliary:settings.primary==='2d'?hi.two:null};
}
