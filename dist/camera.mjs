export function cameraError(error) {
  return ({NotAllowedError:'카메라 권한이 거부되었습니다. 주소창의 사이트 권한에서 카메라를 허용한 뒤 다시 연결하세요.',NotFoundError:'연결된 카메라가 없습니다. USB 카메라 연결을 확인하세요.',NotReadableError:'카메라를 사용할 수 없습니다. 다른 촬영 앱을 종료한 뒤 다시 시도하세요.',OverconstrainedError:'요청한 해상도 또는 카메라를 지원하지 않습니다. 720p / 30 FPS로 변경하세요.',SecurityError:'보안 연결(HTTPS)에서 카메라를 사용할 수 있습니다.'})[error?.name]||error?.message||'카메라 연결에 실패했습니다.';
}
export function setupCamera({getContext,onRecorded,onBusy,toast}) {
  const $=s=>document.querySelector(s),root=$('#camera-panel'),preview=$('#camera-preview'),status=$('#camera-status');
  let stream=null,recorder=null,chunks=[],countdown=null,timer=null,started=0,generation=0,captureContext=null,lastFile=null,lastUrl=null,settings=null;
  const preferences=()=>({resolution:$('#camera-resolution').value,fps:$('#camera-fps').value,facing:$('#camera-facing').value,mirror:$('#camera-mirror').checked,countdown:$('#camera-countdown').value});
  try {const saved=JSON.parse(localStorage.getItem('shoulder:camera')||'{}');for(const key of ['resolution','fps','facing','countdown'])if(saved[key])$('#camera-'+key).value=saved[key];$('#camera-mirror').checked=!!saved.mirror;}catch{}
  function persist(){try{localStorage.setItem('shoulder:camera',JSON.stringify(preferences()));}catch{}preview.style.transform=$('#camera-mirror').checked?'scaleX(-1)':'';}
  persist();
  function busy(value){onBusy(value);$('#camera-connect').disabled=value;for(const id of ['device','resolution','fps','facing','countdown'])$('#camera-'+id).disabled=value;$('#camera-record').disabled=value||!stream;$('#camera-stop').disabled=!value;}
  async function devices(){if(!navigator.mediaDevices?.enumerateDevices)return;const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const current=$('#camera-device').value;$('#camera-device').replaceChildren(new Option('기본 카메라',''),...list.map((d,i)=>new Option(d.label||`카메라 ${i+1}`,d.deviceId)));if(list.some(d=>d.deviceId===current))$('#camera-device').value=current;}
  function release(){generation++;clearInterval(countdown);clearInterval(timer);countdown=null;stream?.getTracks().forEach(t=>t.stop());stream=null;preview.srcObject=null;$('#camera-record').disabled=true;$('#camera-disconnect').disabled=true;}
  async function connect(){
    if(!getContext().valid){toast('환자정보와 측정 팔을 먼저 선택하세요.');return;}
    if(!navigator.mediaDevices?.getUserMedia){status.textContent='이 브라우저는 카메라를 지원하지 않습니다. HTTPS 환경의 최신 브라우저 또는 영상 업로드를 사용하세요.';return;}
    release();const token=++generation;$('#camera-connect').disabled=true;status.textContent='카메라 권한 및 장치를 확인하는 중…';persist();
    try {
      const height=Number($('#camera-resolution').value),device=$('#camera-device').value;
      const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:height*16/9},height:{ideal:height},frameRate:{ideal:Number($('#camera-fps').value)},...(device?{deviceId:{exact:device}}:{facingMode:{ideal:$('#camera-facing').value}})}});
      if(token!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
      stream=acquired;preview.srcObject=stream;await preview.play();settings=stream.getVideoTracks()[0].getSettings();await devices();
      status.textContent=`연결됨 · ${settings.width}×${settings.height} · 실제 ${Number(settings.frameRate||0).toFixed(2)} FPS · 음성 녹음 없음`;
      $('#camera-record').disabled=false;$('#camera-disconnect').disabled=false;
      stream.getVideoTracks()[0].addEventListener('ended',()=>{stop();release();status.textContent='카메라 연결이 끊겼습니다. 촬영 결과를 확인하고 재연결하세요.';},{once:true});
    }catch(error){release();status.textContent=cameraError(error);}finally{$('#camera-connect').disabled=false;}
  }
  function record(){
    if(!stream||recorder?.state==='recording'||countdown)return;
    const context=getContext();if(!context.valid){toast('환자정보를 확인하세요.');return;}
    if(typeof MediaRecorder==='undefined'){status.textContent='이 브라우저는 녹화를 지원하지 않습니다. 기기 카메라로 촬영한 영상을 업로드하세요.';return;}
    captureContext={...context};busy(true);persist();
    let remaining=Number($('#camera-countdown').value);$('#camera-counter').textContent=remaining||'';
    const begin=()=>{
      clearInterval(countdown);countdown=null;$('#camera-counter').textContent='';
      try {
        const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
        recorder=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:6000000}:{});chunks=[];
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        recorder.onerror=e=>{status.textContent=cameraError(e.error);stop();};
        recorder.onstop=async()=>{
          clearInterval(timer);busy(false);const duration=(performance.now()-started)/1000;
          if(!chunks.length){status.textContent='녹화 데이터가 없습니다. 다시 촬영하세요.';return;}
          const blob=new Blob(chunks,{type:recorder.mimeType});const ext=blob.type.includes('mp4')?'mp4':'webm';
          lastFile=new File([blob],`${captureContext.motion}-${captureContext.arm}-${Date.now()}.${ext}`,{type:blob.type});
          if(lastUrl)URL.revokeObjectURL(lastUrl);lastUrl=URL.createObjectURL(lastFile);$('#camera-download').disabled=false;
          status.textContent=`촬영 완료 · ${duration.toFixed(1)}초 · 분석 영상으로 연결 중`;
          release();
          try{await onRecorded(lastFile,{...settings,recordedDuration:duration},captureContext);status.textContent='촬영 완료 · 자동 분석을 시작했습니다. 다음 동작을 등록하세요. 원본 영상을 별도로 저장할 수 있습니다.';}catch(error){status.textContent=error.message;}
        };
        started=performance.now();recorder.start(500);root.classList.add('recording');
        timer=setInterval(()=>{const elapsed=(performance.now()-started)/1000;status.textContent=`● 녹화 중 · ${elapsed.toFixed(1)}초 · ${captureContext.motion} / ${captureContext.arm==='left'?'왼팔':'오른팔'}`;if(elapsed>=120)stop();},200);
      }catch(error){busy(false);status.textContent=cameraError(error);}
    };
    if(!remaining)begin();else countdown=setInterval(()=>{remaining--;$('#camera-counter').textContent=remaining||'';if(!remaining)begin();},1000);
  }
  function stop(){if(countdown){clearInterval(countdown);countdown=null;$('#camera-counter').textContent='';busy(false);status.textContent='촬영 준비를 취소했습니다.';}if(recorder?.state==='recording')recorder.stop();clearInterval(timer);root.classList.remove('recording');}
  $('#camera-connect').onclick=connect;$('#camera-record').onclick=record;$('#camera-stop').onclick=stop;
  $('#camera-disconnect').onclick=()=>{stop();release();status.textContent='카메라가 꺼졌습니다.';};
  $('#camera-download').onclick=()=>{if(lastUrl){const a=document.createElement('a');a.href=lastUrl;a.download=lastFile.name;a.click();}};
  for(const input of root.querySelectorAll('select,input'))input.addEventListener('change',()=>{persist();if(stream&&!recorder?.state?.includes('recording'))status.textContent='설정을 변경했습니다. 카메라 연결을 다시 눌러 적용하세요.';});
  navigator.mediaDevices?.addEventListener?.('devicechange',()=>devices().catch(()=>{}));
  window.addEventListener('pagehide',()=>{stop();release();if(lastUrl)URL.revokeObjectURL(lastUrl);});
  return {stop:()=>{stop();release();},isRecording:()=>!!countdown||recorder?.state==='recording'};
}
