export function isMobileApple(nav=globalThis.navigator){return /iPhone|iPad|iPod/.test(nav?.userAgent??'')||(/Mac/.test(nav?.platform??'')&&(nav?.maxTouchPoints??0)>1);}
export function inferenceSize(width,height,maxEdge){const scale=Math.min(1,maxEdge/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
export class InferenceClient {
  constructor(){this.worker=null;this.requests=new Map();this.sequence=0;this.lowMemory=isMobileApple();this.canvas=null;}
  start(){if(this.worker)return;this.worker=new Worker(new URL('./inference-worker.mjs',import.meta.url));this.worker.onmessage=({data})=>{const request=this.requests.get(data.id);if(!request)return;clearTimeout(request.timer);this.requests.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data);};this.worker.onerror=()=>this.reset(Error('분석 엔진을 불러오지 못했습니다. 네트워크/브라우저를 확인 후 다시 시도하세요.'));}
  reset(error=Error('분석이 취소되었습니다.')){this.worker?.terminate();this.worker=null;if(this.canvas){this.canvas.width=1;this.canvas.height=1;this.canvas=null;}for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(error);}this.requests.clear();}
  call(type,data={},transfer=[]){this.start();return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.reset(Error('분석 엔진 응답 시간이 초과되었습니다. 다시 시도하세요.'));},type==='init'?90000:20000);this.requests.set(id,{resolve,reject,timer});this.worker.postMessage({id,type,...data},transfer);});}
  initialize(withHands){return this.call('init',{withHands,lowMemory:this.lowMemory});}
  async detect(video,withHands,arm,signal){
    if(signal?.aborted)throw new DOMException('분석 취소','AbortError');
    // Resize before allocating the transferable bitmap, also avoiding Safari's
    // video-to-ImageBitmap path. Landmark coordinates remain normalized.
    const size=inferenceSize(video.videoWidth,video.videoHeight,this.lowMemory?960:1280);
    const canvas=this.canvas??=document.createElement('canvas');
    if(canvas.width!==size.width||canvas.height!==size.height){canvas.width=size.width;canvas.height=size.height;}
    canvas.getContext('2d').drawImage(video,0,0,size.width,size.height);
    const bitmap=await createImageBitmap(canvas);
    if(signal?.aborted){bitmap.close();throw new DOMException('분석 취소','AbortError');}
    try{return await this.call('frame',{bitmap,withHands,arm},[bitmap]);}catch(error){bitmap.close();throw error;}
  }
}
