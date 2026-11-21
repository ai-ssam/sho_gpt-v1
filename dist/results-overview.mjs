import {classifyScore,DEFAULT_STAGES} from './v5-core.mjs?v=5.2.0-irer2d';
import {irerFrame,sessionIRER} from './irer-methods.mjs';
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const deg=a=>Number.isFinite(a)?a.toFixed(1)+'°':'계산 불가';
export function decorateResults({state,patient,evaluate,openDetail}){
 if(state.view!=='results')return;
 const hero=document.querySelector('#v5-score'),grid=document.querySelector('#final-summary');if(!hero||!grid)return;
 document.body.dataset.resultsDesign='overview';
 const result=evaluate(state.sessions,state.criteria),stages=state.criteria.stages??DEFAULT_STAGES;
 hero.replaceChildren();hero.classList.add('overview-hero');
 const summary=node('div','overview-total'),label=node('h2','',result.label),number=node('strong','overview-number',result.total===null?'평가 보류':result.total.toFixed(1)+' / 100점'),stage=node('p','v52-stage',result.stage);stage.dataset.color=result.stageColor;
 const track=node('div','overview-scale');for(let i=0;i<3;i++)track.append(node('span','',stages.labels[i]));
 const bounds=node('p','helper',`단계 경계 ${stages.boundaries[0]} / ${stages.boundaries[1]}점 · 관리자 시험 기준`);summary.append(label,number,stage,track,bounds);
 const context=node('div','overview-context');context.append(node('h3','','검사 결과를 한눈에 확인하세요'),node('p','',`${patient.id||'검사 정보 미입력'} · ${patient.arm==='left'?'왼팔':'오른팔'} · ${result.rows.length}개 활성 동작`));
 const pending=result.rows.filter(r=>r.reason);context.append(node('p','helper',pending.length?pending.map(r=>r.code+': '+r.reason).join(' / '):'모든 동작의 평가 조건을 확인했습니다. 자세·좌표 품질은 별도 확인하세요.'));
 context.append(node('p','helper','시험 기준의 동작 제한 점수이며 질환 확률이나 의학적 진단이 아닙니다.'));
 if(pending.length){const review=node('button','button primary','확인할 동작 보기');review.onclick=()=>openDetail(pending[0].code);review.disabled=!state.sessions[pending[0].code]?.frames.length;context.append(review);}
 hero.append(summary,context);
 const cards=[...grid.children];for(let i=0;i<cards.length;i++){
  const card=cards[i],row=result.rows[i];if(!row)continue;const item=state.sessions[row.code];
  card.querySelector('.overview-card-meta')?.remove();
  const img=card.querySelector('.final-representative');if(img)card.prepend(img);else if(!card.querySelector('.overview-empty'))card.prepend(node('div','overview-empty','대표사진 없음 · 원본 연결 후 갱신'));
  const mark=classifyScore(row.score===null?null:row.score/3*100,stages),meta=node('div','overview-card-meta');
  const badge=node('span','v52-stage overview-badge',mark.label);badge.dataset.color=mark.color;
  meta.append(badge,node('span','overview-card-score',row.score===null?row.reason:`의심도 ${(row.score/3*100).toFixed(1)}점 · 가중치 ${row.weight}%`));
  meta.append(node('p','helper',`계산 유효 ${item.rom?.validFrames??0} / ${item.frames.length} 분석 프레임 · ${row.code==='IRER'?(item.measurementConfirmed?'자세·계산 확인됨':'사용자 확인 필요'):'좌표·대표사진 확인 권장'}`));
  if(row.code==='IRER'){
   const ir=sessionIRER(item);meta.append(node('p','overview-method',`${ir.mode==='compare'?'비교 모드 · ':''}주 계산 ${ir.primary==='2d'?'2D 길이비':'기존 3D 추정'}`));
   if(item.rom?.requiresReanalysis)meta.append(node('p','helper','3D 좌표 없음 · 원본 영상 재분석 필요'));
  }
  const title=card.querySelector('h3');title?.after(meta);
 }
}
export function renderIRERComparison({item,arm,index,active,onSelect}){
 let panel=document.querySelector('#irer-comparison');if(!panel){const host=document.querySelector('#full-irer');if(!host)return;panel=node('section','irer-comparison');panel.id='irer-comparison';host.append(panel);}
 const settings=sessionIRER(item);panel.hidden=!active||settings.mode!=='compare';panel.replaceChildren();if(panel.hidden)return;
 const frame=item.frames[index],current=irerFrame(frame,arm,settings,item.irerCalibration);
 panel.append(node('h3','','같은 프레임 비교'));
 const same=node('div','irer-comparison-values');same.append(node('p','',`2D ${deg(current.two?.angle)}`),node('p','',`기존 3D ${deg(current.three?.angle)}`));panel.append(same,node('p','helper',`원본 #${(frame?.sourceFrame??index)+1} · ${(frame?.time??0).toFixed(3)}초 · 차이 ${deg(current.difference)} · 주 계산 ${settings.primary.toUpperCase()}`));
 panel.append(node('p','helper',[...(current.two?.warnings??[]),...(current.three?.warnings??[])].join(' / ')||'두 방식의 자세 조건 통과'));
 const maxima=item.rom?.comparison;
 const maxText=(name,m)=>name+' '+(m?deg(m.angle)+' · #'+(m.sourceFrame+1)+' · '+m.time.toFixed(3)+'초':'계산 불가');
 panel.append(node('h3','','방식별 최대값 · 서로 다른 프레임일 수 있음'),node('p','',maxText('2D 최대',maxima?.twoMax)),node('p','',maxText('기존 3D 최대',maxima?.threeMax)),node('p','helper','두 값의 차이는 기준각 대비 오차가 아닙니다. 점수는 주 계산만 사용하며 평균/자동 대체하지 않습니다.'));
 const page=Math.floor(index/30),rows=maxima?.sameFrame?.slice(page*30,page*30+30)??[];
 if(rows.length){
  const wrap=node('div','comparison-table-wrap'),table=node('table','comparison-table');const head=node('thead');const tr=node('tr');for(const s of ['원본 프레임·초','2D','기존 3D','차이'])tr.append(node('th','',s));head.append(tr);table.append(head);const body=node('tbody');
  for(const r of rows){const line=node('tr');const cell=node('td'),button=node('button','button ghost small',`#${r.sourceFrame+1} · ${r.time.toFixed(3)}s`);button.onclick=()=>onSelect(r.index);cell.append(button);line.append(cell,node('td','',deg(r.two)),node('td','',deg(r.three)),node('td','',deg(r.difference)));body.append(line);}table.append(body);wrap.append(table);panel.append(wrap);
  const nav=node('div','v5-actions');for(const [text,next]of [['이전 30개',(page-1)*30],['다음 30개',(page+1)*30]]){const b=node('button','button ghost small',text);b.disabled=next<0||next>=item.frames.length;b.onclick=()=>onSelect(next);nav.append(b);}panel.append(nav);
 }
 const svg=document.querySelector('#angle-chart svg');if(svg&&item.frames.length){
  const secondary=settings.primary==='2d'?'three':'two',maxTime=Math.max(1,...item.frames.map(f=>f.time));let d='',started=false;
  for(const f of item.frames){const a=irerFrame(f,arm,settings,item.irerCalibration)[secondary]?.angle;if(!Number.isFinite(a)){started=false;continue;}const x=44+f.time/maxTime*698,y=16+244*(1-a/180);d+=(started?'L':'M')+x.toFixed(1)+','+y.toFixed(1);started=true;}
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke','#9262bd');path.setAttribute('stroke-width','2');path.setAttribute('stroke-dasharray','6 4');path.setAttribute('data-irer-secondary','true');svg.querySelector('[data-irer-secondary]')?.remove();svg.append(path);
  panel.append(node('p','helper','그래프: 청록 실선 = 주 계산 / 보라 점선 = 비교 계산'));
 }
}
