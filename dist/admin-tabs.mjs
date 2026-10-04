export function setupAdminTabs(root){
 const panels=new Map(),nav=document.createElement('div');nav.className='admin-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','관리자 설정 분야');
 for(const [id,title]of [['basic','동작·평가기준'],['camera','카메라'],['neutral','중립자세'],['backup','백업·복원']]){
  const panel=document.createElement('section');panel.id='admin-panel-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','admin-tab-'+id);panel.className='admin-tab-panel';panels.set(id,panel);
  const button=document.createElement('button');button.type='button';button.id='admin-tab-'+id;button.textContent=title;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.onclick=()=>select(id);nav.append(button);
 }
 const blocks=[...root.children].filter(x=>x.classList.contains('v52-block'));
 const basic=blocks[0],camera=blocks[1],neutral=blocks[2];
 panels.get('basic').append(basic);panels.get('neutral').append(neutral);
 // The camera block also contains score display settings; split at its heading.
 const scoreHeading=[...camera.querySelectorAll('h3')].find(x=>x.textContent.includes('결과'));
 const scorePanel=document.createElement('section');scorePanel.className='v52-block admin-score-settings';
 if(scoreHeading){let node=scoreHeading;while(node){const next=node.nextSibling;scorePanel.append(node);node=next;}}
 panels.get('camera').append(camera);
 const saveCapture=document.createElement('button'),captureStatus=document.createElement('p');saveCapture.type='button';saveCapture.className='button primary';saveCapture.textContent='중립자세 유지시간 저장·적용';captureStatus.setAttribute('role','status');saveCapture.onclick=()=>{root.querySelector('#v52-save-settings').click();captureStatus.textContent=root.querySelector('#v52-settings-status').textContent;};camera.append(saveCapture,captureStatus);
 const criteriaNodes=[...root.children].filter(node=>node!==nav&&node.id!=='v52-admin-close'&&node.tagName!=='H2');
 panels.get('basic').prepend(...criteriaNodes);panels.get('basic').append(scorePanel);
 basic.querySelector('h3').textContent='측정 기본값 · 보정 옵션';basic.querySelector('p').hidden=true;
 basic.querySelector('#full-motions').hidden=true;
 basic.querySelector('#full-save').hidden=true;basic.querySelector('#full-reset').hidden=true;
 const apply=root.querySelector('#v5-settings-save')??panels.get('basic').querySelector('#v5-settings-save');
 apply.onclick=()=>{for(const input of panels.get('basic').querySelectorAll('#v5-criteria-rows [data-field="weight"]'))basic.querySelector('[data-weight="'+input.dataset.code+'"]').value=input.value;for(const input of panels.get('basic').querySelectorAll('[data-enabled]'))basic.querySelector('[data-motion="'+input.dataset.enabled+'"]').checked=input.checked;basic.querySelector('#full-save').click();panels.get('basic').querySelector('#v5-settings-state').textContent=basic.querySelector('#full-status').textContent;};
 const reset=panels.get('basic').querySelector('#v5-settings-reset');reset.onclick=()=>{basic.querySelector('#full-reset').click();panels.get('basic').querySelector('#v5-settings-state').textContent=basic.querySelector('#full-status').textContent;};
 const table=panels.get('basic').querySelector('.table-scroll');table.classList.add('admin-motion-table');
 const heading=document.createElement('h3');heading.textContent='동작 선택 · 평가 기준';table.before(heading);
 const help=panels.get('basic').querySelector('p');help.textContent='사용할 동작을 선택하고 가중치와 점수 경계를 설정하세요. 선택한 동작의 가중치 합계는 100%여야 합니다. 임상 미검증 시험 기준이며, 저장된 과거 검사는 유지됩니다.';
 panels.get('basic').querySelector('.v5-actions').classList.add('admin-criteria-actions');
 for(const id of ['full-export','full-import']){const node=root.querySelector('#'+id)??basic.querySelector('#'+id);if(node)panels.get('backup').append(id==='full-import'?node.closest('label'):node);}
 root.append(nav,...panels.values());
 function select(id){for(const [key,panel]of panels){panel.hidden=key!==id;const button=nav.querySelector('#admin-tab-'+key);button.setAttribute('aria-selected',String(key===id));button.tabIndex=key===id?0:-1;}}
 nav.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...nav.children],index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();});
 select('basic');
}
