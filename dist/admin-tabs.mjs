export function setupAdminTabs(root){
 const panels=new Map(),nav=document.createElement('div');nav.className='admin-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','관리자 설정 분야');
 for(const [id,title]of [['basic','기본·동작'],['camera','카메라'],['neutral','중립자세'],['criteria','평가기준'],['backup','백업·복원']]){
  const panel=document.createElement('section');panel.id='admin-panel-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','admin-tab-'+id);panel.className='admin-tab-panel';panels.set(id,panel);
  const button=document.createElement('button');button.type='button';button.id='admin-tab-'+id;button.textContent=title;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.onclick=()=>select(id);nav.append(button);
 }
 const blocks=[...root.children].filter(x=>x.classList.contains('v52-block'));
 const basic=blocks[0],camera=blocks[1],neutral=blocks[2];
 panels.get('basic').append(basic);panels.get('neutral').append(neutral);
 // The camera block also contains score display settings; split at its heading.
 const scoreHeading=[...camera.querySelectorAll('h3')].find(x=>x.textContent.includes('결과'));
 if(scoreHeading){let node=scoreHeading;while(node){const next=node.nextSibling;panels.get('criteria').append(node);node=next;}}
 panels.get('camera').append(camera);
 const saveCapture=document.createElement('button'),captureStatus=document.createElement('p');saveCapture.type='button';saveCapture.className='button primary';saveCapture.textContent='중립자세 유지시간 저장·적용';captureStatus.setAttribute('role','status');saveCapture.onclick=()=>{root.querySelector('#v52-save-settings').click();captureStatus.textContent=root.querySelector('#v52-settings-status').textContent;};camera.append(saveCapture,captureStatus);
 for(const node of [...root.children])if(node!==nav&&node.id!=='v52-admin-close'&&node.tagName!=='H2')panels.get('criteria').append(node);
 for(const id of ['full-export','full-import']){const node=root.querySelector('#'+id)??basic.querySelector('#'+id);if(node)panels.get('backup').append(id==='full-import'?node.closest('label'):node);}
 root.append(nav,...panels.values());
 function select(id){for(const [key,panel]of panels){panel.hidden=key!==id;const button=nav.querySelector('#admin-tab-'+key);button.setAttribute('aria-selected',String(key===id));button.tabIndex=key===id?0:-1;}}
 nav.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...nav.children],index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();});
 select('basic');
}
