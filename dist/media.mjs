// MP4/MOV sample-table inspection: source frame ordinals are not analysis indices.
export function inspectMp4(buffer) {
  const v=new DataView(buffer),len=v.byteLength;
  const u32=p=>v.getUint32(p),type=p=>String.fromCharCode(...new Uint8Array(buffer,p,4));
  function boxes(start,end) {
    const out=[];
    for(let p=start;p+8<=end;) {
      let n=u32(p),header=8; if(n===1){if(p+16>end)break;n=Number(v.getBigUint64(p+8));header=16;}if(n===0)n=end-p;
      if(n<header||p+n>end)break;out.push({type:type(p+4),start:p+header,end:p+n});p+=n;
    }return out;
  }
  const child=(b,t)=>b?boxes(b.start,b.end).find(x=>x.type===t):null;
  const root=boxes(0,len),moov=root.find(b=>b.type==='moov');if(!moov)return null;
  for(const trak of boxes(moov.start,moov.end).filter(b=>b.type==='trak')) {
    const mdia=child(trak,'mdia'),hdlr=child(mdia,'hdlr');if(!hdlr||type(hdlr.start+8)!=='vide')continue;
    const mdhd=child(mdia,'mdhd'),stbl=child(child(mdia,'minf'),'stbl'),stts=child(stbl,'stts'),ctts=child(stbl,'ctts');
    if(!mdhd||!stts)return null;
    const scale=u32(mdhd.start+(v.getUint8(mdhd.start)===1?20:12));if(!scale)return null;
    const timestamps=[];let dts=0;
    for(let i=0,n=u32(stts.start+4);i<n;i++) {const p=stts.start+8+i*8;if(p+8>stts.end)throw Error('손상된 MP4 시간표');const count=u32(p),delta=u32(p+4);if(timestamps.length+count>1000000)throw Error('영상이 너무 깁니다. 짧은 동작 영상으로 나누세요.');for(let j=0;j<count;j++){timestamps.push(dts);dts+=delta;}}
    if(ctts) {let k=0;for(let i=0,n=u32(ctts.start+4);i<n;i++){const p=ctts.start+8+i*8;if(p+8>ctts.end)throw Error('손상된 MP4 합성 시간표');const count=u32(p),offset=v.getUint8(ctts.start)===1?v.getInt32(p+4):u32(p+4);for(let j=0;j<count&&k<timestamps.length;j++,k++)timestamps[k]+=offset;}}
    timestamps.sort((a,b)=>a-b);const first=timestamps[0]??0;
    const times=timestamps.map(t=>(t-first)/scale),duration=dts/scale;
    return {frameTimes:times,duration,sourceFps:times.length/duration,frameMapping:'mp4-presentation-sample-table',frameCount:times.length};
  }return null;
}
export async function inspectVideo(file) {
  if(file.size>512*1024*1024)throw Error('영상은 512 MB 이하로 나누어 사용하세요.');
  if(/\.(mp4|mov|m4v)$/i.test(file.name)||/mp4|quicktime/.test(file.type)) {
    // Skip compressed media (mdat) on disk. iPhone MOV files can be hundreds
    // of MB; only the moov sample tables are needed, including tail metadata.
    for(let offset=0,count=0;offset+8<=file.size&&count++<10000;) {
      const header=await file.slice(offset,Math.min(offset+16,file.size)).arrayBuffer();
      const v=new DataView(header);let size=v.getUint32(0),headerSize=8;
      const type=String.fromCharCode(...new Uint8Array(header,4,4));
      if(size===1){if(header.byteLength<16)throw Error('손상된 영상 헤더입니다.');size=Number(v.getBigUint64(8));headerSize=16;}
      if(size===0)size=file.size-offset;
      if(!Number.isSafeInteger(size)||size<headerSize||offset+size>file.size)throw Error('영상 파일이 불완전합니다. 파일 앱에 다운로드한 뒤 다시 선택하세요.');
      if(type==='moov') {
        if(size>16*1024*1024)throw Error('영상 시간표가 너무 큽니다. 짧은 동작 영상으로 나누세요.');
        const info=inspectMp4(await file.slice(offset,offset+size).arrayBuffer());if(info)return info;
        break;
      }
      offset+=size;
    }
  }
  if((/\.webm$/i.test(file.name)||/webm/.test(file.type))&&file.size<=32*1024*1024) {
    const info=inspectWebm(await file.arrayBuffer());if(info)return info;
  }
  return {frameTimes:null,frameMapping:'estimated-fps',sourceFps:null};
}
export function inspectWebm(buffer) {
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);let scale=1000000,videoTrack=1;
  function vint(pos,keep=false){if(pos>=bytes.length||bytes[pos]===0)return null;let length=1,mask=128;while(!(bytes[pos]&mask)){length++;mask>>=1;}if(length>8||pos+length>bytes.length)return null;let value=keep?bytes[pos]:bytes[pos]&(mask-1);let unknown=!keep&&value===mask-1;for(let i=1;i<length;i++){value=value*256+bytes[pos+i];unknown=unknown&&bytes[pos+i]===255;}return{length,value,unknown};}
  function elements(start,end){const out=[];for(let p=start;p<end;){const id=vint(p,true);if(!id)break;const size=vint(p+id.length);if(!size)break;const body=p+id.length+size.length,last=size.unknown?end:body+size.value;if(last>end||last<body)break;out.push({id:id.value,start:body,end:last});p=last;}return out;}
  const number=e=>{let n=0;for(let i=e.start;i<e.end;i++)n=n*256+bytes[i];return n;};
  const root=elements(0,bytes.length),segment=root.find(e=>e.id===0x18538067);if(!segment)return null;
  const parts=elements(segment.start,segment.end),info=parts.find(e=>e.id===0x1549a966),tracks=parts.find(e=>e.id===0x1654ae6b);
  if(info){const entry=elements(info.start,info.end).find(e=>e.id===0x2ad7b1);if(entry)scale=number(entry);}
  if(tracks)for(const entry of elements(tracks.start,tracks.end).filter(e=>e.id===0xae)){const entries=elements(entry.start,entry.end);if(entries.some(e=>e.id===0x83&&number(e)===1)){const num=entries.find(e=>e.id===0xd7);if(num)videoTrack=number(num);}}
  const times=[];
  for(const cluster of parts.filter(e=>e.id===0x1f43b675)){
    const children=elements(cluster.start,cluster.end),stamp=children.find(e=>e.id===0xe7),base=stamp?number(stamp):0;
    for(const el of children){const block=el.id===0xa3?el:el.id===0xa0?elements(el.start,el.end).find(e=>e.id===0xa1):null;if(!block)continue;const track=vint(block.start);if(!track||track.value!==videoTrack)continue;const p=block.start+track.length;if(p+3>block.end)return null;if(bytes[p+2]&6)return null;times.push((base+view.getInt16(p))*scale/1e9);}
  }
  if(times.length<2)return null;times.sort((a,b)=>a-b);const intervals=times.slice(1).map((t,i)=>t-times[i]).filter(d=>d>0).sort((a,b)=>a-b),dt=intervals[Math.floor(intervals.length/2)]||1/30;
  return {frameTimes:times,duration:times.at(-1)+dt,sourceFps:times.length/(times.at(-1)-times[0]+dt),frameMapping:'webm-block-timestamps',frameCount:times.length};
}
const pendingSeeks=new WeakMap();
export async function seekDecodedFrame(video,time,fps=30,{signal,timeoutMs=10000}={}) {
  if(!video.src)throw Error('원본 영상이 없습니다. 다시 연결하세요.');
  if(!Number.isFinite(time)||time<0)throw Error('유효하지 않은 영상 시각입니다.');
  if(signal?.aborted)throw new DOMException('분석 취소','AbortError');
  pendingSeeks.get(video)?.();
  const interval=1/(Number.isFinite(fps)&&fps>0?fps:30),target=time,source=video.src;
  if(Number.isFinite(video.duration)&&target>=video.duration)throw Error('요청한 프레임이 영상 길이를 벗어났습니다.');
  video.pause();
  // Stay inside the requested frame. A 10µs seek can be rounded to zero by
  // the media clock, so no new frame or seek event is produced on some engines.
  const seekTime=Math.min(target+Math.min(.005,interval*.2),Number.isFinite(video.duration)?Math.max(target,video.duration-.0001):Infinity);
  const atPosition=position=>video.src===source&&!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-position)<.002;
  const remember=metadata=>{video._verifiedTime=target;video._verifiedMediaTime=metadata.mediaTime;video._verifiedSource=source;video._verifiedMetadata=metadata;return metadata;};
  if(video._verifiedTime===target&&video._verifiedSource===source&&atPosition(seekTime))return video._verifiedMetadata;
  // loadeddata already made the initial frame drawable. Do not require a
  // second compositor callback for an already-decoded, paused first frame.
  if(atPosition(target)&&Math.abs(video.currentTime-target)<.000001)return remember({mediaTime:null,seekTime:video.currentTime,verification:'current-data'});
  return new Promise((resolve,reject)=> {
    let callback,settleTimer,done=false,seekCompleted=false;
    const cleanup=()=>{clearTimeout(timer);clearTimeout(settleTimer);if(callback!=null)video.cancelVideoFrameCallback?.(callback);for(const event of ['seeked','loadeddata','canplay'])video.removeEventListener(event,onReady);video.removeEventListener('error',onError);signal?.removeEventListener('abort',cancel);if(pendingSeeks.get(video)===cancel)pendingSeeks.delete(video);};
    const finish=(error,metadata)=>{if(done)return;done=true;cleanup();if(error)reject(error);else resolve(remember(metadata));};
    const cancel=()=>finish(new DOMException('프레임 이동 취소','AbortError'));
    const onError=()=>finish(Error('영상 디코딩 실패. 파일 앱에 저장한 MP4(H.264) 영상을 선택하세요.'));
    const onReady=event=>{
      if(event.type==='seeked')seekCompleted=true;
      if(!seekCompleted||!atPosition(seekTime))return;
      clearTimeout(settleTimer);
      // seeked + HAVE_CURRENT_DATA certifies that drawImage can use the
      // requested image even when offscreen composition does not emit rVFC.
      settleTimer=setTimeout(()=>{if(atPosition(seekTime))finish(null,{mediaTime:null,seekTime:video.currentTime,verification:'seeked'});},32);
    };
    const onFrame=(_,metadata)=>{
      if(done)return;
      if(atPosition(seekTime)&&Number.isFinite(metadata.mediaTime)&&Math.abs(metadata.mediaTime-target)<=interval*.55+.001)finish(null,{...metadata,seekTime:video.currentTime,verification:'video-frame-callback'});
      else callback=video.requestVideoFrameCallback(onFrame);
    };
    const timer=setTimeout(()=>finish(Error(`프레임 이동 실패 (${target.toFixed(3)}초, readyState=${video.readyState}, seeking=${!!video.seeking}). 화면을 켠 상태로 다시 분석하거나 MP4(H.264) 파일을 선택하세요.`)),timeoutMs);
    pendingSeeks.set(video,cancel);
    for(const event of ['seeked','loadeddata','canplay'])video.addEventListener(event,onReady);
    video.addEventListener('error',onError,{once:true});signal?.addEventListener('abort',cancel,{once:true});
    try{if(typeof video.requestVideoFrameCallback==='function')callback=video.requestVideoFrameCallback(onFrame);video.currentTime=seekTime;}catch(error){finish(error);}
  });
}
