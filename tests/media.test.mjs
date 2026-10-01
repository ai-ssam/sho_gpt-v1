import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWebm,inspectVideo,seekDecodedFrame} from '../dist/media.mjs';
import {inferenceSize,isMobileApple} from '../dist/inference.mjs';
import {execFileSync} from 'node:child_process';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
let hasFfmpeg=true;try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});}catch{hasFfmpeg=false;}
test('WebM 실제 블록 시각/프레임 수 읽기',{skip:!hasFfmpeg},async()=>{
  const folder=await mkdtemp(tmpdir()+'/rom-webm-');
  try{execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=160x90:r=30:d=1','-an','-c:v','libvpx-vp9',folder+'/test.webm']);const b=await readFile(folder+'/test.webm');const info=inspectWebm(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.equal(info.frameCount,30);assert.equal(info.duration,1);assert.ok(Math.abs(info.sourceFps-30)<.001);}finally{await rm(folder,{recursive:true,force:true});}
});
test('대표 캡처는 이전 프레임 콜백을 무시하고 목표 디코딩을 기다림',async()=>{
  let callback;const cancelled=[];
  const video={src:'blob:test',duration:1,readyState:2,seeking:false,currentTime:0,pause(){},addEventListener(){},removeEventListener(){},requestVideoFrameCallback(fn){callback=fn;return 1;},cancelVideoFrameCallback(id){cancelled.push(id);}};
  let resolved=false;const promise=seekDecodedFrame(video,.5,30).then(m=>{resolved=true;return m;});
  callback(0,{mediaTime:.3});await Promise.resolve();assert.equal(resolved,false);
  callback(0,{mediaTime:.5});const m=await promise;assert.equal(m.mediaTime,.5);assert.equal(video._verifiedTime,.5);assert.ok(cancelled.length);
});
class SeekVideo extends EventTarget {
  constructor({callbacks=false,readyState=2,autoSeek=true}={}){super();this.src='blob:test';this.duration=2;this.readyState=readyState;this.seeking=false;this.position=0;this.autoSeek=autoSeek;this.moves=[];if(callbacks){this.requestVideoFrameCallback=cb=>(this.callback=cb,1);this.cancelVideoFrameCallback=()=>{this.callback=null;};}}
  pause(){}
  get currentTime(){return this.position;}
  set currentTime(value){this.moves.push(value);this.position=value;this.seeking=true;if(this.autoSeek)setTimeout(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));},0);}
}
test('iOS 방식: 합성 콜백 없이 seeked로 연속 프레임 및 역방향 대표 프레임 처리',async()=>{
  const video=new SeekVideo({callbacks:true});
  for(const time of [0,1/30,2/30,.9,.1]){
    const result=await seekDecodedFrame(video,time,30,{timeoutMs:500});
    assert.equal(result.verification,time===0?'current-data':'seeked');assert.equal(result.mediaTime,null,'확인하지 못한 실제 PTS를 만들지 않음');
    assert.ok(result.seekTime>=time&&result.seekTime<time+1/30);
  }
  assert.equal(video.moves.length,4);assert.equal(video.callback,null);
});
test('프레임 콜백 API가 없는 브라우저도 seeked와 현재 데이터 준비를 확인',async()=>{
  const video=new SeekVideo();const result=await seekDecodedFrame(video,.5,30,{timeoutMs:500});assert.equal(result.verification,'seeked');
});
test('seeked만으로는 부족: 현재 프레임 데이터가 준비된 뒤 처리',async()=>{
  const video=new SeekVideo({readyState:1});let done=false;
  const promise=seekDecodedFrame(video,.5,30,{timeoutMs:500}).then(r=>(done=true,r));
  await new Promise(r=>setTimeout(r,45));assert.equal(done,false);
  video.readyState=2;video.dispatchEvent(new Event('loadeddata'));
  assert.equal((await promise).verification,'seeked');
});
test('탐색 완료 이벤트 없이 currentTime만 바뀌면 성공으로 간주하지 않음',async()=>{
  const video=new SeekVideo({autoSeek:false});
  await assert.rejects(seekDecodedFrame(video,.5,30,{timeoutMs:25}),/프레임 이동 실패/);
});
test('분석 취소와 연속 탐색 교체는 대기 중인 프레임을 즉시 해제',async()=>{
  const video=new SeekVideo({autoSeek:false,callbacks:true}),controller=new AbortController();
  const first=seekDecodedFrame(video,.5,30,{signal:controller.signal});const rejected=assert.rejects(first,{name:'AbortError'});controller.abort();await rejected;assert.equal(video.callback,null);
  const replaced=seekDecodedFrame(video,.6,30);const replacedCheck=assert.rejects(replaced,{name:'AbortError'});
  video.autoSeek=true;const next=seekDecodedFrame(video,.7,30);await replacedCheck;assert.equal((await next).verification,'seeked');
});


test('큰 iPhone MOV는 미디어 본문을 읽지 않고 끝의 시간표만 읽음',async()=>{
  const box=(type,...parts)=>{const body=Buffer.concat(parts),header=Buffer.alloc(8);header.writeUInt32BE(8+body.length);header.write(type,4);return Buffer.concat([header,body]);};
  const mdhd=Buffer.alloc(20);mdhd.writeUInt32BE(30000,12);
  const hdlr=Buffer.alloc(12);hdlr.write('vide',8);
  const stts=Buffer.alloc(16);stts.writeUInt32BE(1,4);stts.writeUInt32BE(30,8);stts.writeUInt32BE(1000,12);
  const moov=box('moov',box('trak',box('mdia',box('mdhd',mdhd),box('hdlr',hdlr),box('minf',box('stbl',box('stts',stts))))));
  const mediaSize=200*1024*1024,header=Buffer.alloc(16);header.writeUInt32BE(1);header.write('mdat',4);header.writeBigUInt64BE(BigInt(mediaSize),8);
  let bytesRead=0;
  const file={name:'IMG_001.MOV',type:'video/quicktime',size:mediaSize+moov.length,arrayBuffer(){throw Error('전체 파일 읽기 금지');},slice(start,end){
    const count=end-start;bytesRead+=count;assert.ok(count<2048,'mdat 전체를 복사하지 않음');
    return new Blob([start===0?header:moov.subarray(start-mediaSize,end-mediaSize)]);
  }};
  const info=await inspectVideo(file);assert.equal(info.frameCount,30);assert.equal(info.sourceFps,30);assert.equal(info.duration,1);assert.ok(bytesRead<2048);
});
test('큰 WebM은 전체 파일 복사 없이 명시적 FPS 추정으로 전환',async()=>{
  const info=await inspectVideo({name:'large.webm',type:'video/webm',size:40*1024*1024,arrayBuffer(){throw Error('전체 복사 금지');}});
  assert.equal(info.frameMapping,'estimated-fps');assert.equal(info.frameTimes,null);
});
test('iPhone/iPad 감지 및 세로·가로 4K 프레임 크기 제한',()=>{
  assert.equal(isMobileApple({userAgent:'iPhone'}),true);assert.equal(isMobileApple({userAgent:'Safari',platform:'MacIntel',maxTouchPoints:5}),true);
  assert.equal(isMobileApple({userAgent:'Safari',platform:'MacIntel',maxTouchPoints:0}),false);
  assert.deepEqual(inferenceSize(3840,2160,960),{width:960,height:540});
  assert.deepEqual(inferenceSize(2160,3840,960),{width:540,height:960});
  assert.deepEqual(inferenceSize(640,480,960),{width:640,height:480});
});
test('iOS 손 전체·손 주변 재검출은 동일한 모델을 재사용하고 비트맵을 해제',async()=>{
  const code=await readFile(new URL('../dist/inference-worker.mjs',import.meta.url),'utf8');
  let handsCreated=0,handCalls=0,closed=0;const messages=[];
  const body=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));
  const vision={FilesetResolver:{forVisionTasks:async()=>({})},PoseLandmarker:{createFromOptions:async()=>({detectForVideo:()=>({landmarks:[body]})})},HandLandmarker:{createFromOptions:async (fileset,options)=>{handsCreated++;assert.equal(options.runningMode,'IMAGE');return {detect:()=>{handCalls++;return {landmarks:[],handedness:[]};}};}}};
  const self={location:{href:'https://example.test/inference-worker.mjs'},postMessage:r=>messages.push(r)};
  const context=vm.createContext({self,URL,performance,importScripts:()=>Object.assign(self.exports,vision),OffscreenCanvas:class{getContext(){return {drawImage(){}};}}});
  vm.runInContext(code,context);
  await self.onmessage({data:{id:1,type:'init',withHands:true,lowMemory:true}});
  await self.onmessage({data:{id:2,type:'frame',withHands:true,arm:'left',bitmap:{width:960,height:540,close(){closed++;}}}});
  assert.equal(messages[0].error,undefined);assert.equal(messages[1].error,undefined);assert.equal(handsCreated,1);assert.equal(handCalls,2);assert.equal(closed,1);
});
