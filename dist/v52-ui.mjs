import {ACTIVE_MOTIONS,activeMotions,DEFAULT_STAGES,validateStages,validateCriteria} from './v5-core.mjs';
import {DEFAULT_CAPTURE,validateCapture,makeTemplate,templateStore} from './neutral.mjs';
import {POSE_LANDMARKS} from './geometry.mjs';
import {InferenceClient} from './inference.mjs';
import {inspectVideo,seekDecodedFrame} from './media.mjs';

export function setupV52({state,patient,camera,queue,selectMotion,renderAll,showToast}){
 const $=s=>document.querySelector(s),admin=$('#v5-settings');
 const settingsKey='shoulder:v52:capture';
 let capture={...DEFAULT_CAPTURE},templates=[],selected={},configured='',stream=null,url=null,source=null,draft=null,working=false;
 const engine=new InferenceClient();engine.maxEdge=960;
 try{capture=validateCapture(JSON.parse(localStorage.getItem(settingsKey)||'null'));}catch{}
 try{selected=JSON.parse(localStorage.getItem('shoulder:v52:neutral-selection')||'{}');}catch{}
 $('#v5-settings-button').textContent='관리자 설정';
 admin.querySelector('h2').textContent='관리자 설정';
 admin.insertAdjacentHTML('afterbegin','<button id="v52-admin-close" class="button ghost">← 이전 화면으로</button>');
 admin.insertAdjacentHTML('beforeend',`<section class="v52-block"><h3>카메라 기본 설정</h3><div id="v52-camera-defaults" class="camera-settings"></div><h3>자동촬영 · 중립자세 유지시간</h3><div class="v52-fields"><label>시작 전 유지 (초)<input id="v52-start" type="number" min="0.1" max="60" step="0.1"></label><label>복귀 후 종료 유지 (초)<input id="v52-return" type="number" min="0.1" max="60" step="0.1"></label></div><p>카운트다운과 별도입니다. 검출이 끊기면 유지시간을 다시 측정합니다.</p><h3>결과 3단계 표시 · 시험 기준</h3><div class="v52-fields"><label>경도 시작 점수<input id="v52-boundary-0" type="number" min="0.1" max="99.9" step="0.1"></label><label>중증도 시작 점수<input id="v52-boundary-1" type="number" min="0.1" max="99.9" step="0.1"></label></div><div class="v52-fields"><label>초록 문구<input id="v52-label-0" maxlength="30"></label><label>노랑 문구<input id="v52-label-1" maxlength="30"></label><label>빨강 문구<input id="v52-label-2" maxlength="30"></label></div><p>0 ≤ 점수 &lt; 첫 경계: 초록 / 첫 경계 ≤ 점수 &lt; 둘째 경계: 노랑 / 둘째 경계 ≤ 점수 ≤ 100: 빨강. 기존 저장 기록은 변경하지 않습니다.</p><button id="v52-save-settings" class="button primary">유지시간·3단계 설정 적용</button><p id="v52-settings-status" role="status"></p></section>
 <section class="v52-block"><h3>동작별 중립자세 기준 등록</h3><p>카메라 스틸컷 또는 업로드 영상의 프레임을 선택하세요. 저장 후 관절각·몸통 비율을 자동촬영에 사용합니다. 사람별 절대 길이나 정상 ROM 기준이 아닙니다.</p><div class="v52-fields"><label>동작<select id="v52-motion">${ACTIVE_MOTIONS.map(k=>`<option>${k}</option>`).join('')}</select></label><label>측정 팔<select id="v52-arm"><option value="right">오른팔</option><option value="left">왼팔</option></select></label><label>촬영 방향<select id="v52-view"><option>정면</option><option>측면</option><option>후면</option></select></label></div><div class="v5-actions"><button id="v52-connect" class="button ghost">기준 촬영 카메라 연결</button><button id="v52-stop" class="button ghost">카메라/영상 닫기</button><label class="button ghost">기준 영상 업로드<input id="v52-video-input" type="file" accept="video/*" hidden></label></div><video id="v52-video" controls muted playsinline></video><div class="v5-actions"><button id="v52-prev" class="button ghost">이전 프레임</button><button id="v52-next" class="button ghost">다음 프레임</button><button id="v52-capture" class="button primary">현재 화면을 기준 스틸컷으로 선택</button></div><p id="v52-source" role="status">기준 영상을 선택하거나 카메라를 연결하세요.</p><canvas id="v52-still" width="640" height="360" aria-label="기준 스틸컷과 관절점"></canvas><div id="v52-points" class="v52-fields"></div><div class="v52-fields"><label>각도 허용오차 (°)<input id="v52-angle" type="number" min="1" max="60" value="15"></label><label>위치 허용오차 (몸통 길이 비율)<input id="v52-position" type="number" min="0.01" max="1" step="0.01" value="0.2"></label></div><button id="v52-save-neutral" class="button primary" disabled>관절점 확인 · 새 기준 버전 저장</button><p id="v52-neutral-status" role="status"></p><label class="field">저장 기준 버전<select id="v52-history"><option value="">기본 시험 기준 사용</option></select></label><button id="v52-use-neutral" class="button ghost">선택 기준을 자동촬영에 적용</button><p>원본 기준 영상은 별도 보관하세요. 선택 스틸컷·관절점·출처·영상 시각은 기준에 저장됩니다.</p></section>`);
 for(const id of ['device','facing','resolution','fps','mirror'])$('#v52-camera-defaults').append($('#camera-'+id).closest('label'));
 const video=$('#v52-video'),canvas=$('#v52-still');
 function settingsFields(){
  $('#v52-start').value=capture.startSeconds;$('#v52-return').value=capture.returnSeconds;
  const stages=state.criteria.stages??DEFAULT_STAGES;
  stages.boundaries.forEach((v,i)=>$('#v52-boundary-'+i).value=v);stages.labels.forEach((v,i)=>$('#v52-label-'+i).value=v);
 }
 function cleanup(){
  stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;video.removeAttribute('src');video.load();if(url)URL.revokeObjectURL(url);url=null;source=null;engine.reset();
 }
 function clearDraft(){draft=null;$('#v52-save-neutral').disabled=true;$('#v52-points').replaceChildren();canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);}
 function closeAdmin(){if(working){showToast('기준 처리 완료 후 이동하세요.');return;}cleanup();admin.hidden=true;document.body.dataset.admin='false';}
 $('#v5-settings-button').onclick=()=>{
  if(state.cameraBusy||state.refining||state.view==='detail'){showToast('촬영·상세 수정을 완료한 뒤 설정하세요.');return;}
  if(document.body.dataset.admin==='true'){closeAdmin();return;}
  camera.stop();document.dispatchEvent(new window.Event('v52-settings-changed'));settingsFields();admin.hidden=false;document.body.dataset.admin='true';history();
 };
 $('#v52-admin-close').onclick=closeAdmin;
 document.addEventListener('v52-criteria',settingsFields);
 $('#v52-save-settings').onclick=()=>{try{
  if(state.cameraBusy||state.refining||state.view==='detail')throw Error('촬영·수정을 완료하세요.');
  const next=validateCapture({startSeconds:Number($('#v52-start').value),returnSeconds:Number($('#v52-return').value)});
  const stages=validateStages({boundaries:[0,1].map(i=>Number($('#v52-boundary-'+i).value)),labels:[0,1,2].map(i=>$('#v52-label-'+i).value.trim())});
  const criteria=validateCriteria({...structuredClone(state.criteria),stages,version:'pc-v52-'+new Date().toISOString()});
  // Persist before updating live state, so quota errors are not reported as success.
  const previous=localStorage.getItem(settingsKey);
  localStorage.setItem(settingsKey,JSON.stringify(next));
  try{localStorage.setItem('shoulder:v5:criteria',JSON.stringify(criteria));}catch(e){if(previous===null)localStorage.removeItem(settingsKey);else localStorage.setItem(settingsKey,previous);throw e;}
  capture=next;state.criteria=criteria;configured='';configure();renderAll();$('#v52-settings-status').textContent='저장·적용 완료 · 3단계 경계는 임상 미검증 시험값입니다.';
 }catch(e){$('#v52-settings-status').textContent=e.message;}};
 function key(){return $('#v52-motion').value+':'+$('#v52-arm').value;}
 function history(){
  const list=$('#v52-history');list.replaceChildren();const fallback=document.createElement('option');fallback.value='';fallback.textContent='기본 시험 기준 사용';list.append(fallback);
  for(const t of templates.filter(t=>t.motion+':'+t.arm===key()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){const o=document.createElement('option');o.value=t.id;o.textContent=t.version+' · '+t.source.kind+' · '+t.view;list.append(o);}
  list.value=selected[key()]??'';
 }
 function configure(){
  const k=state.activeMotion+':'+patient().arm,id=selected[k],template=templates.find(t=>t.id===id),signature=JSON.stringify([k,id,capture]);
  if(signature===configured||state.cameraBusy)return;
  camera.configure(capture,template);configured=signature;
 }
 async function loadTemplates(){try{templates=await templateStore('list');history();configured='';configure();}catch(e){$('#v52-neutral-status').textContent='저장 기준을 불러오지 못했습니다: '+e.message;}}
 function selectTemplate(){
  try{const next={...selected,[key()]:$('#v52-history').value};localStorage.setItem('shoulder:v52:neutral-selection',JSON.stringify(next));selected=next;configured='';configure();$('#v52-neutral-status').textContent='기준 선택 적용됨 · '+($('#v52-history').selectedOptions[0]?.textContent??'');}catch(e){$('#v52-neutral-status').textContent=e.message;}
 }
 $('#v52-use-neutral').onclick=selectTemplate;
 for(const id of ['motion','arm','view'])$('#v52-'+id).onchange=()=>{clearDraft();if(id==='motion')$('#v52-view').value=['FE2','FE','ER','CIR'].includes($('#v52-motion').value)?'측면':$('#v52-motion').value==='BIR'?'후면':'정면';history();};
 async function task(fn){if(working)return;working=true;const controls=[...admin.querySelectorAll('button,input,select')],disabled=controls.map(el=>el.disabled);controls.forEach(el=>el.disabled=true);try{await fn();}catch(e){$('#v52-neutral-status').textContent=e.message;}finally{working=false;controls.forEach((el,i)=>el.disabled=disabled[i]);$('#v52-save-neutral').disabled=!draft;}}
 $('#v52-connect').onclick=()=>task(async()=>{
  cleanup();clearDraft();camera.stop();if(!navigator.mediaDevices?.getUserMedia)throw Error('이 브라우저에서 카메라를 지원하지 않습니다. 기준 영상 업로드를 사용하세요.');
  const device=$('#camera-device').value,height=Number($('#camera-resolution').value);
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{height:{ideal:height},frameRate:{ideal:Number($('#camera-fps').value)},...(device?{deviceId:{exact:device}}:{facingMode:{ideal:$('#camera-facing').value}})}});
  video.srcObject=stream;await video.play();source={kind:'camera',settings:stream.getVideoTracks()[0].getSettings()};$('#v52-source').textContent='카메라 연결됨 · 중립자세를 취한 뒤 기준 스틸컷 선택';
 });
 $('#v52-stop').onclick=()=>{cleanup();$('#v52-source').textContent='입력을 닫았습니다. 선택한 스틸컷은 저장할 수 있습니다.';};
 $('#v52-video-input').onchange=e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;void task(async()=>{
  cleanup();clearDraft();const info=await inspectVideo(file);url=URL.createObjectURL(file);video.src=url;
  source={kind:'upload',fileName:file.name,fileSize:file.size,...info};
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>done(Error('기준 영상 로딩 시간이 초과되었습니다.')),15000);function done(error){clearTimeout(timeout);video.onloadeddata=null;video.onerror=null;error?reject(error):resolve();}video.onloadeddata=()=>done();video.onerror=()=>done(Error('기준 영상을 재생할 수 없습니다.'));video.load();});
  $('#v52-source').textContent=file.name+' · '+(info.duration||video.duration).toFixed(2)+'초 · 재생/일시정지 또는 프레임 이동 후 선택';
 });};
 for(const [id,delta]of [['prev',-1],['next',1]])$('#v52-'+id).onclick=()=>task(async()=>{
  if(source?.kind!=='upload')throw Error('프레임 이동은 업로드 영상에서 사용할 수 있습니다.');
  const times=source.frameTimes,fps=source.sourceFps||30;
  let target;if(times?.length){const current=times.reduce((best,t,i)=>Math.abs(t-video.currentTime)<Math.abs(times[best]-video.currentTime)?i:best,0);target=times[Math.max(0,Math.min(times.length-1,current+delta))];}
  else target=Math.max(0,Math.min(video.duration-1/fps,video.currentTime+delta/fps));
  await seekDecodedFrame(video,target,fps);$('#v52-source').textContent=`${source.fileName} · ${target.toFixed(4)}초 · ${times?.length?'원본 시간표':'FPS 추정 이동'}`;
 });
 function pointFields(){
  const root=$('#v52-points');root.replaceChildren();
  for(const part of ['shoulder','elbow','wrist','hip']){const id=draft.arm+'_'+part,p=draft.corrected[id],label=document.createElement('label');label.textContent=id;
   for(const axis of ['x','y']){const input=document.createElement('input');input.type='number';input.min='0';input.max='1';input.step='.001';input.value=p[axis];input.setAttribute('aria-label',id+' '+axis);input.onchange=()=>{const value=Number(input.value);if(input.value===''||!Number.isFinite(value)||value<0||value>1){input.value=p[axis];return;}p[axis]=value;p.visibility=1;p.status='manual';draw();};label.append(input);}root.append(label);
  }
 }
 function draw(){
  if(!draft)return;const image=new Image(),current=draft;image.onload=()=>{if(draft!==current)return;const ctx=canvas.getContext('2d');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;ctx.drawImage(image,0,0);ctx.fillStyle='#ffdb4d';ctx.strokeStyle='#14394a';ctx.font='14px sans-serif';for(const part of ['shoulder','elbow','wrist','hip']){const p=draft.corrected[draft.arm+'_'+part],x=p.x*canvas.width,y=p.y*canvas.height;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillText(part,x+9,y-6);}};image.src=draft.image;
 }
 $('#v52-capture').onclick=()=>task(async()=>{
  if(!source||video.readyState<2||!video.videoWidth)throw Error('영상을 먼저 준비하세요.');
  video.pause();const arm=$('#v52-arm').value,motion=$('#v52-motion').value,time=video.currentTime;
  // Freeze first: camera frames must not advance between image and landmark inference.
  const still=document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);still.width=Math.round(video.videoWidth*scale);still.height=Math.round(video.videoHeight*scale);still.getContext('2d').drawImage(video,0,0,still.width,still.height);
  const image=still.toDataURL('image/jpeg',.85);clearDraft();$('#v52-neutral-status').textContent='선택 프레임의 관절점을 검출하는 중…';
  await engine.initialize(false);const bitmap=await createImageBitmap(still);const result=await engine.call('frame',{bitmap,withHands:false,arm},[bitmap]);
  const raw=Object.fromEntries(POSE_LANDMARKS.map(p=>[p.id,result.poses?.[0]?.[p.index]?{...result.poses[0][p.index],aspectRatio:still.width/still.height,status:'detected'}:{x:.5,y:.5,visibility:0,aspectRatio:still.width/still.height,status:'missing'}]));
  const times=source.frameTimes,fps=source.sourceFps||30,frameIndex=times?.length?times.reduce((best,t,i)=>Math.abs(t-time)<Math.abs(times[best]-time)?i:best,0):Math.round(time*fps);
  draft={motion,arm,view:$('#v52-view').value,image,raw,corrected:structuredClone(raw),source:{kind:source.kind,fileName:source.fileName,fileSize:source.fileSize,settings:source.settings,time,frameIndex:source.kind==='upload'?frameIndex:null,frameMapping:times?.length?'source-timestamps':'estimated-fps'}};
  pointFields();draw();$('#v52-neutral-status').textContent=result.poses?.length?'관절점을 확인하세요. 좌표 수정 후 새 버전으로 저장합니다.':'관절점 미검출 · 아래 4개 관절점을 모두 수동 지정해야 저장할 수 있습니다.';
 });
 $('#v52-save-neutral').onclick=()=>task(async()=>{
  if(!draft)throw Error('기준 스틸컷을 먼저 선택하세요.');
  const template=makeTemplate({...draft,angleTolerance:Number($('#v52-angle').value),positionTolerance:Number($('#v52-position').value)});
  await templateStore('save',template);templates.push(template);history();$('#v52-history').value=template.id;$('#v52-neutral-status').textContent='새 기준 저장 완료 · '+template.version+' · 아래 적용 버튼으로 자동촬영에 연결하세요.';
 });
 $('#v52-history').onchange=()=>{
  const saved=templates.find(t=>t.id===$('#v52-history').value);if(!saved){clearDraft();return;}draft=structuredClone(saved);$('#v52-view').value=saved.view;$('#v52-angle').value=saved.angleTolerance;$('#v52-position').value=saved.positionTolerance;pointFields();draw();$('#v52-save-neutral').disabled=false;
 };
 $('#motion-grid').insertAdjacentHTML('afterend','<section id="v52-upload-files" class="card v52-block"><h3>등록 영상 · 파일정보</h3><div id="v52-files"></div></section>');
 let filesKey='';
 function files(){
  const signature=JSON.stringify(activeMotions(state.criteria).map(k=>{const s=state.sessions[k];return[k,s.fileName,s.fileSize,s.duration,s.videoWidth,s.videoHeight,s.videoUrl,s.analysisStatus,s.snapshot];}));if(signature===filesKey)return;filesKey=signature;
  const root=$('#v52-files');root.replaceChildren();
  for(const code of activeMotions(state.criteria)){const item=state.sessions[code];if(!item.fileName)continue;
   const row=document.createElement('article');row.className='v52-file';const media=document.createElement('video');media.muted=true;media.preload='auto';media.playsInline=true;media.setAttribute('aria-label',code+' 영상 썸네일');
   if(item.snapshot){const img=document.createElement('img');img.src=item.snapshot;img.alt=code+' 영상 대표 썸네일';row.append(img);}else if(item.videoUrl){media.src=item.videoUrl;row.append(media);}else{const note=document.createElement('span');note.textContent='원본 다시 연결 필요';row.append(note);}
   const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');title.textContent=code+' · '+item.fileName;detail.textContent=`${Number(item.duration||0).toFixed(2)}초 · ${item.videoWidth||'—'}×${item.videoHeight||'—'} · ${(item.fileSize/1048576).toFixed(2)} MB · ${item.analysisStatus||'등록됨'}`;info.append(title,detail);row.append(info);
   const replace=document.createElement('button');replace.className='button ghost';replace.textContent='파일 교체';replace.disabled=!!state.cameraBusy||!!state.refining;replace.onclick=()=>{selectMotion(code);$('#video-upload').click();};row.append(replace);root.append(row);
  }
  if(!root.children.length)root.textContent='동작 카드를 눌러 영상을 선택하세요. 등록한 영상의 썸네일과 정보는 여기에 표시됩니다.';
 }
 for(const card of document.querySelectorAll('.motion-card'))card.addEventListener('click',()=>{if(document.body.dataset.mode!=='upload'||state.view!=='capture'||state.cameraBusy||state.refining)return;if($('#video-upload').disabled){showToast('환자 필수정보와 측정 팔을 먼저 입력하세요.');return;}$('#video-upload').click();});
 document.addEventListener('v5-render',()=>{configure();files();});
 window.addEventListener('pagehide',cleanup);
 settingsFields();configure();files();void loadTemplates();
}
