export const MOTIONS=['AB','FE','ER','BIR','IRER'];
export function workflowStatus(sessions) {
  const uploaded=MOTIONS.filter(code=>sessions[code]?.fileName).length;
  const complete=MOTIONS.filter(code=>['complete','review'].includes(sessions[code]?.analysisStatus)).length;
  const errors=MOTIONS.filter(code=>sessions[code]?.analysisStatus==='error');
  const pending=MOTIONS.filter(code=>['queued','analyzing'].includes(sessions[code]?.analysisStatus));
  return {uploaded,complete,errors,pending,canFinalize:uploaded===5,ready:complete===5};
}
// One inference job at a time. Replacing one motion never cancels another motion.
export class AnalysisQueue {
  constructor(run,onChange=()=>{}) {this.run=run;this.onChange=onChange;this.pending=[];this.active=null;this.running=false;}
  enqueue(code,item) {
    this.cancel(code);
    const job={code,item,controller:new AbortController()};
    item.analysisStatus='queued';item.analysisProgress=0;item.analysisError=null;
    this.pending.push(job);this.onChange();void this.drain();return job;
  }
  cancel(code) {
    for(const job of this.pending.filter(j=>j.code===code)){job.controller.abort();job.item.analysisStatus='cancelled';}
    this.pending=this.pending.filter(j=>j.code!==code);
    if(this.active?.code===code){this.active.controller.abort();this.active.item.analysisStatus='cancelled';}
  }
  cancelAll(){for(const job of this.pending)job.controller.abort();this.pending=[];this.active?.controller.abort();}
  async drain(){
    if(this.running)return;this.running=true;
    try{while(this.pending.length){const job=this.pending.shift();this.active=job;if(job.controller.signal.aborted)continue;
      job.item.analysisStatus='analyzing';this.onChange();
      try{await this.run(job.code,job.item,job.controller.signal);if(!job.controller.signal.aborted)job.item.analysisStatus=job.item.rom?.valid?'complete':'review';}
      catch(error){if(job.controller.signal.aborted)job.item.analysisStatus='cancelled';else{job.item.analysisStatus='error';job.item.analysisError=error.message||'분석 실패';}}
      finally{this.active=null;this.onChange();}
    }}finally{this.running=false;this.onChange();}
  }
}
