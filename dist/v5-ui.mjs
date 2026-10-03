import {createArchive} from './archive.mjs';
import {ACTIVE_MOTIONS,DEFAULT_CRITERIA,evaluate,validateCriteria} from './v5-core.mjs';
export function setupV5(api){
 const {state,session,patient,camera,queue,selectMotion,setView,selectFrame,renderAll,showToast,analyzeSession,recalculateCurrentRom,discardDetail,patientPayload}=api;
 const $=s=>document.querySelector(s);
 let mode='upload',refining=false;
 try{const c=JSON.parse(localStorage.getItem('shoulder:v5:criteria'));if(c)state.criteria=validateCriteria(c);}catch{}
 const add=(target,position,html)=>$(target).insertAdjacentHTML(position,html);
 add('main','afterbegin',`<section id="v5-home" class="card v5-home"><span class="eyebrow">SHOULDER ROM LAB / V5</span><h2>어깨의 움직임을 기록하세요</h2><p>한쪽 팔 · 다섯 동작 · 동작당 한 번. 촬영한 영상과 결과를 함께 보관합니다.</p><div class="v5-mode-grid"><button class="v5-mode" data-mode="camera"><b>카메라로 촬영</b><span>자세 안내와 자동 촬영으로 검사하기 →</span></button><button class="v5-mode" data-mode="upload"><b>영상 업로드</b><span>준비한 영상으로 분석하기 →</span></button></div><button id="v5-resume" class="button ghost">진행 중 검사 / 저장된 검사 열기</button></section><nav class="v5-nav"><button id="v5-home-button" class="button ghost">홈</button><button id="v5-back" class="button ghost">이전 단계</button><span id="v5-mode-name">영상 업로드</span><button id="v5-switch" class="button ghost">모드 선택</button><button id="v5-settings-button" class="button ghost">PC 설정</button></nav><section id="v5-settings" class="card v5-settings" hidden><h2>평가 기준 설정</h2><p>동작 의심도점수 · 시험 기준. 설정 변경은 현재 검사에 적용하며 저장된 검사 기준은 보존합니다.</p><div class="table-scroll"><table><thead><tr><th>동작</th><th>가중치 %</th><th>0점 경계</th><th>1점 경계</th><th>2점 경계</th></tr></thead><tbody id="v5-criteria-rows"></tbody></table></div><label class="field">BIR 수준 (0점부터 3점까지, 각 줄은 |로 구분)<textarea id="v5-bir" rows="4"></textarea></label><div class="v5-actions"><button id="v5-settings-save" class="button primary">설정 적용</button><button id="v5-settings-export" class="button ghost">CSV 내보내기</button><label class="button ghost">CSV 가져오기<input id="v5-settings-import" type="file" accept=".csv" hidden></label><button id="v5-settings-reset" class="button ghost">샘플 기준 복원</button></div><p id="v5-settings-state" role="status"></p></section>`);
 add('.camera-settings','beforeend',`<label class="check-field"><input id="v5-auto" type="checkbox">중립자세 자동 촬영 (시험)</label><label class="field"><span>촬영 안내</span><select id="v5-sound"><option value="beep">신호음</option><option value="voice">음성</option><option value="off">끄기</option></select></label><div class="v5-guides"><label><input id="v5-center" type="checkbox" checked> 중심선</label><label><input id="v5-horizontal" type="checkbox" checked> 수평선</label><label><input id="v5-area" type="checkbox" checked> 촬영 영역</label><label><input id="v5-guide-text" type="checkbox" checked> 자세 안내</label></div>`);
 add('.camera-preview-wrap','beforeend','<i class="v5-center-line"></i>');
 add('#camera-status','afterend','<p id="v5-pose-state" role="status">자동 촬영: 시작자세 유지 → 1회 동작 → 시작자세 복귀</p>');
 for(const id of ['center','horizontal','area','guide-text'])$('#v5-'+id).onchange=()=>{
  $('.v5-center-line').hidden=!$('#v5-center').checked;
  $('.camera-guide i').hidden=!$('#v5-horizontal').checked;
  $('.camera-guide').style.borderColor=$('#v5-area').checked?'':'transparent';
  $('#camera-guide-text').hidden=!$('#v5-guide-text').checked;
 };
 add('.timeline-wrap','afterend',`<section id="v5-range" class="v5-range"><h3>분석구간 / 정밀 재분석</h3><div class="v5-actions"><label>시작 (초)<input id="v5-range-start" type="number" min="0" step=".01" value="0"></label><label>종료 (초)<input id="v5-range-end" type="number" min="0" step=".01"></label><button id="v5-range-start-now" class="button ghost">현재를 시작으로</button><button id="v5-range-end-now" class="button ghost">현재를 종료로</button><button id="v5-range-apply" class="button primary">구간 적용·재분석</button><button id="v5-refine" class="button dark">구간 정밀 재분석</button><button id="v5-range-reset" class="button ghost">전체 구간 복원</button></div><p id="v5-range-status" role="status">초기 분석 후 구간을 지정하세요. 정밀 재분석은 선택 구간을 매 프레임 분석하고 기존 수정을 보존합니다.</p></section>`);
 add('.correction-card .panel-actions','beforebegin',`<section id="v5-world" class="advanced-settings" hidden><h3>IRER 3D 관절점</h3><p>정규화 화면 좌표와 별개인 모델 추정 좌표(m)입니다. 2D 드래그는 외회전각을 변경하지 않습니다.</p><div id="v5-world-fields"></div><button id="v5-world-apply" class="button ghost">3D 좌표 적용</button><label><input id="v5-confirm" type="checkbox">IRER 자세·추정값을 확인했습니다</label></section>`);
 add('.results','afterbegin','<article id="v5-score" class="card v5-score"></article>');
 add('.results-actions','beforeend','<button id="v5-print" class="button ghost">결과 출력</button><button id="v5-original" class="button ghost">현재 원본 다운로드</button><button id="v5-archive" class="button dark">결과 + 원본 ZIP</button>');
 const download=(name,blob)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const leaveDetail=()=>{if(state.view!=='detail')return true;discardDetail();return state.view!=='detail';};
 const home=()=>{if(refining||state.cameraBusy){showToast('촬영 또는 정밀 분석을 완료한 뒤 이동하세요.');return;}if(!leaveDetail())return;camera.stop();document.body.dataset.home='true';};
 $('#v5-home-button').onclick=home;$('#v5-switch').onclick=home;
 $('#v5-resume').onclick=()=>{document.body.dataset.home='false';setView('capture');};
 $('#v5-back').onclick=()=>{if(refining||state.cameraBusy)return;if(state.view==='detail'){discardDetail();return;}if(state.view==='results')setView('capture');else home();};
 for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{
  mode=b.dataset.mode;document.body.dataset.mode=mode;document.body.dataset.home='false';
  $('#camera-panel').open=mode==='camera';$('#v5-mode-name').textContent=mode==='camera'?'카메라 촬영':'영상 업로드';setView('capture');selectMotion(state.activeMotion);
 };
 document.body.dataset.mode=mode;document.body.dataset.home='true';
 $('#v5-settings-button').onclick=()=>{$('#v5-settings').hidden=!$('#v5-settings').hidden;settingsRows();};
 function settingsRows(){
  const body=$('#v5-criteria-rows');body.replaceChildren();
  for(const k of ACTIVE_MOTIONS){
   const row=document.createElement('tr'),name=document.createElement('th');name.textContent=k;row.append(name);
   for(const [field,value]of [['weight',state.criteria.weights[k]],...(k==='BIR'?[]:state.criteria.thresholds[k].map((v,i)=>['t'+i,v]))]){
    const cell=document.createElement('td'),input=document.createElement('input');input.type='number';input.min='0';input.step='.1';input.value=value;input.dataset.code=k;input.dataset.field=field;input.setAttribute('aria-label',k+' '+field);cell.append(input);row.append(cell);
   }body.append(row);
  }$('#v5-bir').value=state.criteria.bir.map(a=>a.join('|')).join('\n');
 }
 function saveCriteria(c){
  if(refining||state.cameraBusy||state.view==='detail')throw Error('촬영·편집을 완료한 뒤 기준을 변경하세요.');
  validateCriteria(c);localStorage.setItem('shoulder:v5:criteria',JSON.stringify(c));state.criteria=c;settingsRows();render();$('#v5-settings-state').textContent='적용됨 · '+c.version;
 }
 $('#v5-settings-save').onclick=()=>{try{
  const c=structuredClone(state.criteria);for(const input of $('#v5-criteria-rows').querySelectorAll('input')){if(input.value.trim()==='')throw Error('빈 값을 입력할 수 없습니다.');const k=input.dataset.code,f=input.dataset.field;if(f==='weight')c.weights[k]=Number(input.value);else c.thresholds[k][Number(f[1])]=Number(input.value);}
  c.bir=$('#v5-bir').value.trim().split(/\r?\n/).map(l=>l.split('|').map(x=>x.trim()));c.version='pc-'+new Date().toISOString();saveCriteria(c);
 }catch(e){$('#v5-settings-state').textContent=e.message;}};
 $('#v5-settings-reset').onclick=()=>{try{saveCriteria(structuredClone(DEFAULT_CRITERIA));}catch(e){showToast(e.message);}};
 $('#v5-settings-export').onclick=()=>{
  const rows=['motion,weight,score,min_inclusive,max_exclusive,categories'];
  for(const k of ACTIVE_MOTIONS)for(let i=0;i<4;i++){const t=state.criteria.thresholds[k];rows.push([k,state.criteria.weights[k],i,k==='BIR'?'':i===3?0:t[i],k==='BIR'||i===0?'':t[i-1],k==='BIR'?state.criteria.bir[i].join('|'):''].join(','));}
  download('shoulder-v5-criteria.csv',new Blob(['\ufeff'+rows.join('\n')],{type:'text/csv;charset=utf-8'}));
 };
 $('#v5-settings-import').onchange=async e=>{try{
  const file=e.target.files[0];if(!file)return;if(file.size>100000)throw Error('CSV 파일이 너무 큽니다.');
  const lines=(await file.text()).replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(l=>l.split(','));
  const header=lines.shift(),col=name=>header.indexOf(name),legacy=header.includes('motion_code');
  const c=structuredClone(DEFAULT_CRITERIA),seen=new Set();
  for(const r of lines){
   const k=r[col(legacy?'motion_code':'motion')],i=Number(r[col('score')]),key=k+':'+i;
   if(!ACTIVE_MOTIONS.includes(k)||!Number.isInteger(i)||i<0||i>3||seen.has(key))throw Error('CSV 동작/점수 중복 또는 형식 오류');seen.add(key);
   const weight=Number(r[col(legacy?'weight_percent':'weight')]);if(i>0&&c.weights[k]!==weight)throw Error('같은 동작의 가중치가 다릅니다.');c.weights[k]=weight;
   if(k==='BIR')c.bir[i]=r[col(legacy?'category_values':'categories')].split('|');
   else if(i<3)c.thresholds[k][i]=Number(r[col('min_inclusive')]);
  }
  if(seen.size!==20)throw Error('5개 동작의 20개 구간이 필요합니다.');
  for(const r of lines){const k=r[col(legacy?'motion_code':'motion')],i=Number(r[col('score')]);if(k==='BIR')continue;const lo=r[col('min_inclusive')],hi=r[col('max_exclusive')];if(lo===''||Number(lo)!==(i===3?0:c.thresholds[k][i])||(i===0?hi!=='':Number(hi)!==c.thresholds[k][i-1]||hi===''))throw Error('CSV 경계값이 연결되지 않습니다.');}
  c.version='csv-'+new Date().toISOString();saveCriteria(c);
 }catch(e){$('#v5-settings-state').textContent=e.message;}finally{e.target.value='';}};
 function range(){
  const start=Number($('#v5-range-start').value),end=Number($('#v5-range-end').value),item=session();
  if(!item.videoUrl||$('#v5-range-end').value===''||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>item.duration+.02)throw Error('원본 영상과 올바른 시작·종료 시각을 확인하세요.');
  return {start,end};
 }
 for(const edge of ['start','end'])$('#v5-range-'+edge+'-now').onclick=()=>{$('#v5-range-'+edge).value=String(session().frames[state.currentIndex]?.time??$('#video').currentTime);};
 $('#v5-range-reset').onclick=()=>{$('#v5-range-start').value='0';$('#v5-range-end').value=session().duration||'';};
 $('#v5-range-apply').onclick=async()=>{try{
  if(refining||queue.running)throw Error('진행 중 분석을 기다려 주세요.');
  if(!confirm('구간 재분석 시 이 동작의 수동 보정을 초기화합니다. 계속할까요?'))return;
  const selection=range(),item=session();item.analysisRange=selection;
  if(state.view==='detail'){refining=true;await analyzeSession(state.activeMotion,item,new AbortController().signal);renderAll();await selectFrame(item.finalRepresentativeFrame??0);}
  else queue.enqueue(state.activeMotion,item);
 }catch(e){showToast(e.message);}finally{refining=false;render();}};
 $('#v5-refine').onclick=async()=>{let item;try{
  if(state.view!=='detail')throw Error('최종 결과의 상세보기에서 정밀 재분석하세요.');
  if(refining||queue.running)throw Error('진행 중 분석을 기다려 주세요.');
  const selected=range();item=session();
  if(item.analysisRange&&(selected.start<item.analysisRange.start||selected.end>item.analysisRange.end))throw Error('적용된 분석구간 안에서 정밀 구간을 선택하세요.');
  const originalAuto=structuredClone(item.autoRom),originalStep=item.frameStep,bir=item.birManualSpineLevel;
  item.refineRange=selected;item.frameStep=1;refining=true;render();
  try{await analyzeSession(state.activeMotion,item,new AbortController().signal);item.autoRom=originalAuto;item.birManualSpineLevel=bir;recalculateCurrentRom();renderAll();await selectFrame(item.finalRepresentativeFrame??0);showToast('정밀 재분석 완료 · 기존 관절점 수정 유지');}
  finally{item.frameStep=originalStep;delete item.refineRange;}
 }catch(e){showToast(e.message);}finally{refining=false;render();}};
 $('#v5-world-apply').onclick=()=>{const f=session().frames[state.currentIndex];if(!f?.worldRaw)return;try{
  const points=structuredClone(f.worldCorrected??f.worldRaw);
  for(const input of $('#v5-world-fields').querySelectorAll('input')){const v=Number(input.value);if(input.value===''||!Number.isFinite(v)||Math.abs(v)>5)throw Error('3D 좌표는 -5~5 m 범위의 숫자로 입력하세요.');points[input.dataset.point][input.dataset.axis]=v;}
  f.worldCorrected=points;session().measurementConfirmed=false;recalculateCurrentRom();renderAll();render();
 }catch(e){showToast(e.message);}};
 $('#v5-confirm').onchange=()=>{session().measurementConfirmed=$('#v5-confirm').checked;};
 $('#v5-print').onclick=()=>window.print();
 $('#v5-archive').onclick=async()=>{try{
  if(queue.running||refining||state.view==='detail')throw Error('분석과 상세 수정을 완료하세요.');
  const entries=[],payload=patientPayload();payload.archiveVideos={};
  for(const code of ACTIVE_MOTIONS){const item=state.sessions[code];if(!item.fileName)continue;if(!item.sourceFile)throw Error(code+' 원본 영상이 없습니다. 다시 연결하세요.');const name='videos/'+code+'-'+item.fileName.replace(/[^a-zA-Z0-9._-]/g,'_');entries.push({name,blob:item.sourceFile});payload.archiveVideos[code]=name;}
  if(!entries.length)throw Error('먼저 영상을 등록하세요.');
  $('#v5-archive').disabled=true;showToast('결과와 원본을 ZIP으로 묶고 있습니다.');
  entries.unshift({name:'result.json',blob:new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})});
  download('shoulder-v5-'+Date.now()+'.zip',await createArchive(entries));showToast('ZIP 다운로드를 시작했습니다. 압축을 풀면 결과와 원본을 확인할 수 있습니다.');
 }catch(e){showToast(e.message);}finally{$('#v5-archive').disabled=false;}};
 $('#v5-original').onclick=()=>{const item=session();if(!item.sourceFile){showToast('원본 영상을 다시 연결하세요.');return;}download(item.fileName,item.sourceFile);};
 let frameKey='',rangeItem=null;
 function render(){
  const item=session(),busy=refining||state.cameraBusy||queue.running;
  state.refining=refining;
  $('#workflow-title').textContent=state.view==='capture'?(mode==='camera'?'1. 카메라 촬영':'1. 영상 업로드'):state.view==='results'?'2. 최종 분석 결과':'3. 상세결과 · 관절점 수정';
  for(const id of ['v5-refine','v5-range-apply','apply-detail','discard-detail','v5-home-button','v5-back','v5-switch']){const el=$('#'+id);if(el)el.disabled=refining||!!state.cameraBusy;}
  $('#v5-range').hidden=!item.fileName||state.view==='results';
  $('#v5-range-status').textContent=refining?'선택 구간을 매 프레임 분석하는 중…':item.performance?'처리 '+(item.performance.elapsedMs/1000).toFixed(1)+'초 · '+item.performance.delegate+' · '+item.frames.length+' 프레임':'초기 분석 후 구간을 지정하세요.';
  if(rangeItem!==item){rangeItem=item;$('#v5-range-start').value=item.analysisRange?.start??0;$('#v5-range-end').value=item.analysisRange?.end??item.duration??'';}
  if(document.activeElement!==$('#v5-range-end')&&!$('#v5-range-end').value)$('#v5-range-end').value=item.duration||'';
  $('#v5-refine').disabled=busy;$('#v5-range-apply').disabled=busy;
  $('#v5-world').hidden=state.activeMotion!=='IRER'||state.view!=='detail';
  $('#v5-confirm').checked=!!item.measurementConfirmed;
  const f=item.frames[state.currentIndex],key=state.activeMotion+':'+state.currentIndex+':'+item.updatedAt+':'+state.view;
  if(key!==frameKey){frameKey=key;$('#v5-world-fields').replaceChildren();for(const [id,p]of Object.entries(f?.worldCorrected??f?.worldRaw??{})){
   const label=document.createElement('label');label.className='v5-world-row';label.textContent=id;
   for(const axis of ['x','y','z']){const input=document.createElement('input');input.type='number';input.step='.001';input.value=p[axis];input.dataset.point=id;input.dataset.axis=axis;input.setAttribute('aria-label',id+' '+axis);label.append(input);}$('#v5-world-fields').append(label);
  }}
  const score=evaluate(state.sessions,state.criteria),panel=$('#v5-score');panel.replaceChildren();
  const title=document.createElement('h2');title.textContent=score.label;
  const value=document.createElement('strong');value.textContent=score.total===null?'— / 100':score.total.toFixed(1)+' / 100';
  const stage=document.createElement('p');stage.textContent=score.stage+' · 시험 기준 / 질환 확률 아님';
  panel.append(title,value,stage);
  for(const row of score.rows){const line=document.createElement('span');line.className='v5-score-chip';line.textContent=row.code+' · '+(row.score===null?row.reason:row.score+'/3점');panel.append(line);}
  if(state.legacyMeasurements?.CIR){const note=document.createElement('p');note.textContent='이전 CIR 기록 보존됨 · JSON 내보내기에 포함';panel.append(note);}
 }
 document.addEventListener('v5-render',render);
 for(const id of ['prev-frame','next-frame','frame-slider'])$('#'+id).addEventListener(id==='frame-slider'?'input':'click',()=>setTimeout(render,100));
 document.querySelectorAll('.motion-card').forEach(b=>b.addEventListener('click',()=>{$('#v5-range-start').value=session().analysisRange?.start??0;$('#v5-range-end').value=session().analysisRange?.end??session().duration??'';render();}));
 settingsRows();render();
}
