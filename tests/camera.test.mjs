import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {setupCamera,acquireCamera} from '../dist/camera.mjs';

test('unsupported camera constraints fall back once; permission denial never retries',async()=>{
 const calls=[],stream={};const media={getUserMedia:async options=>{calls.push(options);if(calls.length===1)throw Object.assign(Error('unsupported'),{name:'OverconstrainedError'});return stream;}};
 const result=await acquireCamera(media,{deviceId:{exact:'removed-camera'}});assert.equal(result.stream,stream);assert.equal(result.fallback,true);assert.equal(calls.length,2);assert.equal(calls[1].audio,false);assert.equal(calls[1].video.height.ideal,720);
 let count=0;await assert.rejects(acquireCamera({getUserMedia:async()=>{count++;throw Object.assign(Error('denied'),{name:'NotAllowedError'});}},{height:720}));assert.equal(count,1);
});
test('카메라 권한 실패 후 재연결·무음 촬영·원본 전달·장치 해제',async()=>{
  const dom=new JSDOM(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),{url:'https://camera.test'}),w=dom.window;
  globalThis.document=w.document;globalThis.window=w;globalThis.localStorage=w.localStorage;globalThis.Option=w.Option;
  w.HTMLMediaElement.prototype.play=async()=>{};let denied=true,requested,stops=0,received;
  const track={getSettings:()=>({width:1280,height:720,frameRate:30}),stop:()=>stops++,addEventListener(){}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async options=>{requested=options;if(denied)throw Object.assign(Error('denied'),{name:'NotAllowedError'});return stream;},enumerateDevices:async()=>[{kind:'videoinput',label:'Test camera',deviceId:'test'}],addEventListener(){}}}});
  globalThis.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.mimeType='video/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['test'],{type:'video/webm'})});void this.onstop?.();}};
  const context={valid:true,motion:'FE',arm:'left',patientId:'TEST'},busy=[];
  const camera=setupCamera({getContext:()=>context,onBusy:value=>busy.push(value),onRecorded:async(file,settings,captured)=>{received={file,settings,captured};},toast:()=>{}});
  const $=s=>w.document.querySelector(s);
  $('#camera-connect').click();await new Promise(r=>setTimeout(r,10));assert.match($('#camera-status').textContent,/권한/);assert.equal($('#camera-record').disabled,true);
  denied=false;$('#camera-connect').click();await new Promise(r=>setTimeout(r,10));assert.equal(requested.audio,false);assert.equal($('#camera-record').disabled,false);assert.match($('#camera-status').textContent,/1280×720/);
  $('#camera-countdown').value='0';$('#camera-record').click();assert.equal(camera.isRecording(),true);assert.equal($('#camera-stop').disabled,false);
  $('#camera-stop').click();await new Promise(r=>setTimeout(r,10));assert.equal(camera.isRecording(),false);assert.ok(stops>0);assert.equal(received.captured.motion,'FE');assert.equal(received.captured.arm,'left');assert.equal(received.settings.frameRate,30);assert.equal($('#camera-download').disabled,false);assert.deepEqual(busy,[true,false]);
  camera.stop();dom.window.close();
});
