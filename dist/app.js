import {
  LANDMARKS, POSE_LANDMARKS, CONNECTIONS, MOTION_DEFINITIONS, analyzeRom, buildFrameTargets, clonePoints,
  editedPointIds, elbowAngles, frameRecord, framesToCsv, nextMonotonicTimestamp, shoulderAngles, summarize,
  templatePoints, trackedHandPoint, resolveRepresentativeFrame, validateAnalysis, usable, visiblePointIds, cirTrack, auditFields
} from "./analysis.mjs";
import { setupCamera } from './camera.mjs';
import { seekDecodedFrame, inspectVideo } from './media.mjs?v=4.0.2';
import {AnalysisQueue,workflowStatus} from './workflow.mjs';
import {InferenceClient,inferenceSize} from './inference.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const MOTIONS = Object.keys(MOTION_DEFINITIONS);
const emptySession = () => ({
  fileName: null, fileSize: 0, duration: 0, videoUrl: null, frames: [], rom: null,
  snapshot: null, sourceFps: 30, frameStep: 1, updatedAt: null, persistedOnly: false,
  expectedFrames: 0, missedFrames: 0, validation: null, validationTarget: "", validationTolerance: 5,
  loadToken: null, autoRepresentativeFrame: null, manualRepresentativeFrame: null,
  finalRepresentativeFrame: null, representativeSelectionType: "auto", snapshotSourceFrame: null,
  cirManualStartFrame: null, cirManualEndFrame: null, autoRom: null, birManualSpineLevel: null, birTrackingPoint: 'auto', gapFrames: 5, gapSeconds: .2, measuredArm: null
});

const elements = {
  patientId: $("#patient-id"), patientName: $("#patient-name"), patientGender: $("#patient-gender"),
  patientAge: $("#patient-age"), armInputs: $$('input[name="arm"]'), patientState: $("#patient-state"),
  patientStateDot: $("#patient-state-dot"), profileState: $(".profile-state"), savedPatients: $("#saved-patients"),
  loadPatient: $("#load-patient"), temporaryPatient: $("#temporary-patient"), motionCards: $$(".motion-card"),
  motionImageInput: $("#motion-image-input"), uploadLabel: $("#upload-label"),
  uploadLabelText: $("#upload-label-text"), upload: $("#video-upload"), sourceFps: $("#source-fps"),
  frameStep: $("#frame-step"),
  validationTarget: $("#validation-target"), validationTolerance: $("#validation-tolerance"),
  validationMetric: $("#validation-metric"), validationResult: $("#validation-result"),
  frameCoverage: $("#frame-coverage"), handModelState: $("#hand-model-state"),
  analyze: $("#analyze-button"), activeView: $("#active-view"), activeMeasure: $("#active-measure"),
  video: $("#video"), stage: $("#video-stage"), overlay: $("#overlay"), emptyTitle: $("#empty-title"),
  emptyGuide: $("#empty-guide"), progress: $("#progress-panel"), progressTitle: $("#progress-title"),
  progressDetail: $("#progress-detail"), progressBar: $("#progress-bar"), slider: $("#frame-slider"),
  prev: $("#prev-frame"), next: $("#next-frame"), play: $("#play-toggle"), currentTime: $("#current-time"),
  durationTime: $("#duration-time"), status: $("#status-line"), frameBadge: $("#frame-badge"),
  romLabel: $("#rom-label"), romValue: $("#rom-value"), romDetail: $("#rom-detail"),
  leftAngleCard: $("#left-angle-card"), rightAngleCard: $("#right-angle-card"), leftAngle: $("#left-angle"),
  rightAngle: $("#right-angle"), phase: $("#phase-label"), list: $("#landmark-list"),
  motionDetail: $("#motion-detail"), detailALabel: $("#detail-a-label"), detailAValue: $("#detail-a-value"),
  detailAMeta: $("#detail-a-meta"), detailBLabel: $("#detail-b-label"), detailBValue: $("#detail-b-value"), detailBMeta: $("#detail-b-meta"),
  editCount: $("#edit-count"), selectedName: $("#selected-point-name"), rawX: $("#raw-x"),
  rawY: $("#raw-y"), correctedX: $("#corrected-x"), correctedY: $("#corrected-y"),
  representativeStatus: $("#representative-status"), setRepresentative: $("#set-representative"),
  restoreRepresentative: $("#restore-representative"), cirRangeActions: $("#cir-range-actions"),
  setCirStart: $("#set-cir-start"), setCirEnd: $("#set-cir-end"),
  resetFrame: $("#reset-frame"), savePatient: $("#save-patient"), resultPatient: $("#result-patient"),
  motionResultStrip: $("#motion-result-strip"), exportCsv: $("#export-csv"), exportJson: $("#export-json"),
  summaryRomLabel: $("#summary-rom-label"), summaryRom: $("#summary-rom"), summaryRomDetail: $("#summary-rom-detail"),
  summaryMaxLabel: $("#summary-max-label"), summaryMax: $("#summary-max"), summaryMaxTime: $("#summary-max-time"),
  summaryMinLabel: $("#summary-min-label"), summaryMin: $("#summary-min"),
  summaryMinTime: $("#summary-min-time"), summaryQuality: $("#summary-quality"), summaryFrames: $("#summary-frames"),
  chartTitle: $("#chart-title"), chartLegend: $(".chart-legend"), chart: $("#angle-chart"), snapshotWrap: $("#snapshot-wrap"), snapshotMeta: $("#snapshot-meta"),
  downloadSnapshot: $("#download-snapshot"), resultsBody: $("#results-body"), tableCount: $("#table-count"),
  pagePrev: $("#page-prev"), pageNext: $("#page-next"), pageLabel: $("#page-label"), toast: $("#toast")
};

const state = {
  activeMotion: "AB", sessions: Object.fromEntries(MOTIONS.map(code => [code, emptySession()])),
  currentIndex: 0, selectedPoint: "left_shoulder", page: 1, pageSize: 14,
  poseLandmarker: null, handLandmarker: null, visionFileset: null, visionModule: null,
  modelState: "idle", handModelStatus: "idle", dragPoint: null, analysisId: 0,
  inferenceTimestamps: { pose: 0, hand: 0 },
  coordinatePlaybackTimer: null
};

const ctx = elements.overlay.getContext("2d");
const svgNs = "http://www.w3.org/2000/svg";

function session() { return state.view==='detail'&&state.draft?state.draft:state.sessions[state.activeMotion]; }

function patient() {
  const arm = elements.armInputs.find(input => input.checked)?.value ?? "";
  return {
    id: elements.patientId.value.trim(), name: elements.patientName.value.trim(),
    gender: elements.patientGender.value, age: Number(elements.patientAge.value) || null, arm
  };
}

function patientValid() {
  const value = patient();
  return Boolean(value.id && value.gender && value.age >= 1 && value.age <= 120 && value.arm);
}

function armName(arm = patient().arm) { return arm === "left" ? "왼팔" : arm === "right" ? "오른팔" : "측정 팔"; }

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function formatTime(seconds = 0) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function normalizeFps(value) {
  return Number(Math.max(1, Math.min(120, Number(value) || 30)).toFixed(3));
}

function primaryRomText(rom) {
  if (!rom) return "—";
  return `${rom.primaryValue}${rom.primaryUnit}`;
}

function spineLevelMeaning(level) {
  const labels = { T7: "제7흉추", T9: "제9흉추", T12: "제12흉추", L1: "제1요추", L3: "제3요추", L5: "제5요추", "천골": "천골" };
  return labels[level] ? `${level} = ${labels[level]} 높이` : String(level ?? "—");
}

function setProgress(show, title = "", detail = "", ratio = 0) {
  elements.progress.hidden = !show;
  elements.progressTitle.textContent = title;
  elements.progressDetail.textContent = detail;
  elements.progressBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function stopCoordinatePlayback() {
  clearInterval(state.coordinatePlaybackTimer);
  state.coordinatePlaybackTimer = null;
  if (elements.video.paused) elements.play.textContent = "▶";
}

function setFrameControls(enabled) {
  for (const element of [elements.slider, elements.prev, elements.next, elements.play, elements.phase, elements.resetFrame,
    elements.setRepresentative]) {
    element.disabled = !enabled;
  }
  elements.restoreRepresentative.disabled = !enabled || !Number.isInteger(session().manualRepresentativeFrame);
  elements.setCirStart.disabled = !enabled || state.activeMotion !== "CIR";
  elements.setCirEnd.disabled = !enabled || state.activeMotion !== "CIR";
  const hasAnyResults = MOTIONS.some(code => state.sessions[code].frames.length);
  elements.savePatient.disabled = !(patientValid() && hasAnyResults);
  $('#save-final').disabled=!(patientValid()&&hasAnyResults)||MOTIONS.some(code=>['queued','analyzing'].includes(state.sessions[code].analysisStatus));
  elements.exportJson.disabled = !(patientValid() && hasAnyResults);
  elements.exportCsv.disabled = !session().frames.length;
  elements.downloadSnapshot.disabled = !session().snapshot;
  if(state.view!=='detail'){elements.setRepresentative.disabled=true;elements.restoreRepresentative.disabled=true;elements.setCirStart.disabled=true;elements.setCirEnd.disabled=true;}
}

function updatePatientGate() {
  const ready = patientValid();
  elements.profileState.classList.toggle("ready", ready);
  elements.patientState.textContent = ready ? `${armName()} 측정 준비` : "필수정보 미입력";
  elements.upload.disabled = !ready;
  elements.uploadLabel.classList.toggle("disabled", !ready);
  elements.resultPatient.textContent = ready
    ? `${patient().id}${patient().name ? ` · ${patient().name}` : ""} · ${patient().gender} · ${patient().age}세 · ${armName()}`
    : "환자를 입력하면 결과가 연결됩니다.";
  if (!ready) elements.status.textContent = "성별·나이·측정할 팔과 환자번호를 입력해 주세요.";
  else if (!session().fileName && !session().frames.length) elements.status.textContent = `${state.activeMotion} 동작 영상을 선택해 주세요.`;
  recalculateAllRom();
  updateMotionCards();
  setFrameControls(session().frames.length > 0);
  renderResults();
}

function currentFrame() { return session().frames[state.currentIndex] ?? null; }

function isSideMotion(code = state.activeMotion) { return ["FE", "ER", "CIR"].includes(code); }

function measuredPrefix() { return patient().arm === "left" ? "left" : "right"; }

function visibleLandmarks() {
  const ids = visiblePointIds(measuredPrefix(), state.activeMotion);
  return LANDMARKS.filter(item => ids.includes(item.id)).sort((a,b)=>Number(b.id.startsWith(measuredPrefix()))-Number(a.id.startsWith(measuredPrefix())));
}

function representativeIndex(item = session()) {
  const automatic = item.autoRom ? item.autoRom.representativeFrameIndex : item.rom?.representativeFrameIndex ?? null;
  const manual = Number.isInteger(item.manualRepresentativeFrame) ? item.manualRepresentativeFrame : null;
  return manual ?? automatic;
}

function syncRepresentativeState(item = session()) {
  Object.assign(item, resolveRepresentativeFrame(
    item.autoRom ? item.autoRom.representativeFrameIndex : item.rom?.representativeFrameIndex, item.manualRepresentativeFrame, item.frames.length
  ));
}

function analysisOptions(item = session()) {
  return {
    birTrackingPoint: item.birTrackingPoint, birManualSpineLevel: item.birManualSpineLevel,
    gapFrames: item.gapFrames, gapSeconds: item.gapSeconds,
    cirStartFrame: Number.isInteger(item.cirManualStartFrame) ? item.cirManualStartFrame : undefined,
    cirEndFrame: Number.isInteger(item.cirManualEndFrame) ? item.cirManualEndFrame : undefined
  };
}

function updateMotionCards() {
  for (const card of elements.motionCards) {
    const code = card.dataset.motion;
    const motionSession = state.sessions[code];
    card.classList.toggle("selected", code === state.activeMotion);
    card.classList.toggle("has-video", Boolean(motionSession.fileName));
    card.classList.toggle("has-result", Boolean(motionSession.rom));
    card.setAttribute("aria-selected", String(code === state.activeMotion));
    const label = card.querySelector(".upload-state");
    if(['queued','analyzing','error','review'].includes(motionSession.analysisStatus))label.textContent=jobLabel(motionSession);
    else if (motionSession.rom) label.textContent = `${primaryRomText(motionSession.rom)} 분석완료`;
    else if (motionSession.fileName) label.textContent = motionSession.fileName.length > 20 ? `${motionSession.fileName.slice(0, 17)}…` : motionSession.fileName;
    else if (motionSession.frames.length) label.textContent = "저장 결과";
    else label.textContent = "영상 없음";
  }
}

function clearVideoElement() {
  elements.video.pause();
  delete elements.video._verifiedTime;
  delete elements.video._verifiedMediaTime;
  delete elements.video._verifiedSource;
  delete elements.video._verifiedMetadata;
  elements.video.removeAttribute("src");
  elements.video.load();
}

function selectMotion(code) {
  if (!MOTION_DEFINITIONS[code]) return;
  stopCoordinatePlayback();
  state.activeMotion = code;
  state.currentIndex = 0;
  state.page = 1;
  state.selectedPoint = `${measuredPrefix()}_shoulder`;
  const definition = MOTION_DEFINITIONS[code];
  const activeSession = session();
  elements.uploadLabelText.textContent = `${code} 영상 선택`;
  elements.activeView.textContent = `${definition.view} 촬영`;
  elements.activeMeasure.textContent = definition.measure;
  elements.emptyTitle.textContent = patientValid() ? `${code} 영상을 선택하세요` : `환자정보 입력 후 ${code} 영상을 선택하세요`;
  elements.emptyGuide.textContent = `${definition.view} · ${definition.guide}`;
  elements.sourceFps.value = String(activeSession.sourceFps || activeSession.sampleFps || 30);
  elements.sourceFps.disabled=!!activeSession.frameTimes?.length||['queued','analyzing'].includes(activeSession.analysisStatus);
  elements.frameStep.disabled=['queued','analyzing'].includes(activeSession.analysisStatus);
  elements.frameStep.value = String(activeSession.frameStep || 1);
  elements.validationTarget.value = activeSession.validationTarget ?? "";
  elements.validationTolerance.value = String(activeSession.validationTolerance ?? 5);
  updateValidationLabels();
  elements.slider.max = String(Math.max(0, activeSession.frames.length - 1));
  elements.slider.value = "0";
  elements.durationTime.textContent = formatTime(activeSession.duration || activeSession.frames.at(-1)?.time || 0);
  elements.currentTime.textContent = formatTime(activeSession.frames[0]?.time || 0);
  if (activeSession.videoUrl && !(engine.lowMemory && state.view==='capture' && queue.running)) {
    elements.video.dataset.motion = code;
    elements.video.dataset.loadToken = activeSession.loadToken ?? "";
    elements.video.src = activeSession.videoUrl;
    elements.video.load();
    elements.stage.classList.remove("empty");
    elements.analyze.disabled = true;
    elements.status.textContent = `${code} 영상을 불러오는 중입니다.`;
  } else {
    clearVideoElement();
    elements.analyze.disabled = true;
    if (activeSession.frames.length) {
      elements.stage.classList.remove("empty");
      elements.stage.style.aspectRatio = "16 / 9";
      elements.overlay.width = 1280;
      elements.overlay.height = 720;
      elements.status.textContent = `${code} 저장 결과 · 영상은 보존되지 않았습니다.`;
    } else {
      elements.stage.classList.add("empty");
      elements.status.textContent = patientValid() ? `${code} 동작 영상을 선택해 주세요.` : "환자 기본정보를 입력해 주세요.";
    }
  }
  updateMotionCards();
  setFrameControls(activeSession.frames.length > 0);
  renderAll();
}

function nearestFrameIndex(time) {
  const frames = session().frames;
  if (!frames.length) return 0;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time < time) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && Math.abs(frames[low - 1].time - time) < Math.abs(frames[low].time - time)) return low - 1;
  return low;
}

function extractPosePoints(landmarks) {
  const points = Object.fromEntries(POSE_LANDMARKS.map(item => {
    const point = landmarks[item.index];
    return [item.id, {
      x: Number(point.x.toFixed(6)), y: Number(point.y.toFixed(6)), z: Number((point.z ?? 0).toFixed(6)),
      visibility: Number((point.visibility ?? 0).toFixed(4))
    }];
  }));
  points.left_hand_tip = { ...points.left_wrist, visibility: 0 };
  points.right_hand_tip = { ...points.right_wrist, visibility: 0 };
  return points;
}

function fuseHandPoints(points, handResult, measuredArm=measuredPrefix()) {
  const candidates = (handResult?.landmarks ?? []).map((landmarks, index) => ({
    wrist: landmarks[0], tip: landmarks[4],
    score: Number(handResult.handedness?.[index]?.[0]?.score ?? 0.7)
  })).filter(item => item.wrist && item.tip);
  const unused = new Set(candidates.map((_, index) => index));
  for (const side of [measuredArm, measuredArm==='left'?'right':'left']) {
    const poseWrist = points[`${side}_wrist`];
    let bestIndex = null;
    let bestDistance = Infinity;
    for (const index of unused) {
      const candidate = candidates[index];
      const distance = Math.hypot(candidate.wrist.x - poseWrist.x, candidate.wrist.y - poseWrist.y);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    }
    if (!usable(poseWrist) || bestIndex == null || bestDistance > 0.15) continue;
    const candidate = candidates[bestIndex];
    unused.delete(bestIndex);
    points[`${side}_hand_tip`] = {
      x: Number(candidate.tip.x.toFixed(6)), y: Number(candidate.tip.y.toFixed(6)),
      z: Number((candidate.tip.z ?? 0).toFixed(6)), visibility: Number(candidate.score.toFixed(4))
    };
  }
  return points;
}

let foregroundSeek=Promise.resolve();
function seekVideoFrame(time) {
  const video=elements.video,src=video.src,item=session();
  const task=foregroundSeek.catch(()=>{}).then(async()=>{
    if(video.src!==src)throw Error('선택 영상이 변경되었습니다.');
    const metadata=await seekDecodedFrame(video,time,item.sourceFps);
    state.decodedTime=metadata.mediaTime;return metadata;
  });
  foregroundSeek=task;return task;
}

function assignPhases(frames, rom) {
  if (!rom || !frames.length) return;
  const peak = rom.representativeFrameIndex;
  const readyEnd = Math.max(1, Math.round(frames.length * 0.08));
  const finishStart = Math.max(peak + 1, Math.round(frames.length * 0.92));
  frames.forEach((frame, index) => {
    if (index < readyEnd) frame.phase = "준비";
    else if (index < peak) frame.phase = "진입";
    else if (index === peak) frame.phase = "최대ROM";
    else if (index < finishStart) frame.phase = "복귀";
    else frame.phase = "완료";
  });
}

function validationDescriptor(code = state.activeMotion) {
  if (code === "BIR") return { label: "목표 몸통 높이 지수", unit: "%", placeholder: "예: 82" };
  if (code === "CIR") return { label: "목표 궤적 진원도", unit: "%", placeholder: "예: 85" };
  return { label: "목표 ROM", unit: "°", placeholder: "예: 150" };
}

function updateValidationLabels() {
  const descriptor = validationDescriptor();
  if (elements.validationMetric) elements.validationMetric.textContent = descriptor.label;
  if (elements.validationTarget) elements.validationTarget.placeholder = descriptor.placeholder;
  if (elements.handModelState) {
    elements.handModelState.textContent = ["BIR", "CIR"].includes(state.activeMotion)
      ? (state.handModelStatus === "ready" ? "Pose + Hand 활성" : "분석 시 손 추적 활성")
      : "Pose 분석";
  }
  renderValidation();
}

function renderValidation() {
  if (!elements.validationResult || !elements.frameCoverage) return;
  const result = session().validation;
  if (!result) {
    elements.frameCoverage.textContent = "분석 전";
    elements.validationResult.textContent = "목표값을 입력하면 분석 직후 자동 판정합니다.";
    elements.validationResult.className = "validation-result";
    return;
  }
  elements.frameCoverage.textContent = `${result.processedFrames}/${result.expectedFrames} 프레임 · ${result.coverage}%`;
  const targetText = result.metricPass == null
    ? "목표값 미설정"
    : `측정 ${result.actual} · 목표 ${result.target} ±${result.tolerance}`;
  elements.validationResult.textContent = `${result.passed == null ? '미판정' : result.passed ? "통과" : "확인 필요"} · ${targetText}${result.missingFrames ? ` · 누락 ${result.missingFrames}` : " · 처리 누락 없음 (검출 성공과 별개)"}`;
  elements.validationResult.className = `validation-result ${result.passed ? "pass" : "fail"}`;
}

async function analyzeVideo() {
  if(!patientValid() || !session().videoUrl)return;
  const item=state.sessions[state.activeMotion];
  if(item.frames.length&&!confirm('이 동작을 다시 분석하면 수동 보정이 초기화됩니다. 계속할까요?'))return;
  queue.enqueue(state.activeMotion,item);
}

async function analyzeSession(code,item,signal) {
  const arm=item.measuredArm,video=document.createElement('video');
  if(engine.lowMemory&&state.view==='capture')clearVideoElement();
  video.muted=true;video.playsInline=true;video.preload='auto';video.className='analysis-decoder';
  document.body.appendChild(video);
  const abort=()=>engine.reset(new DOMException('분석 취소','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  try {
    await loadAnalysisVideo(video,item.videoUrl,signal);
    if(signal.aborted)return;
    const withHands=true;
    await engine.initialize(withHands);
    const fps=item.sourceFps||30,step=item.frameStep||1;
    const duration=item.frameTimes?.length?item.duration:video.duration;
    if(!Number.isFinite(duration)||duration<=0)throw Error('영상 길이를 읽지 못했습니다. MP4로 변환하거나 다시 촬영하세요.');
    const targets=item.frameTimes?.length?item.frameTimes.map((time,sourceFrame)=>({time,sourceFrame})).filter((_,i)=>i%step===0):buildFrameTargets(duration,fps,step);
    if(targets.length>15000)throw Error('분석할 프레임이 너무 많습니다. 영상을 나누거나 분석 간격을 늘리세요.');
    const frames=[];let missed=0;
    for(let i=0;i<targets.length;i++) {
      if(signal.aborted)return;
      const {time,sourceFrame}=targets[i];
      const decoded=await seekDecodedFrame(video,time,fps,{signal});
      if(signal.aborted)return;
      const result=await engine.detect(video,withHands,arm,signal);
      if(signal.aborted)return;
      let points;
      if(result.poses?.[0]) {
        points=extractPosePoints(result.poses[0]);
        if(result.hands)fuseHandPoints(points,result.hands,arm);
      } else {points=templatePoints(0);missed++;}
      for(const point of Object.values(points)){point.aspectRatio=video.videoWidth/video.videoHeight;point.status=usable(point)?'detected':'missing';}
      const frame=frameRecord({index:i,time,motion:code,points,source:result.poses?.length?(withHands?'Pose+Hand':'Pose'):'미검출·수동보정 필요'});
      Object.assign(frame,{sourceFrame,sourceFps:fps,decodeTime:decoded.mediaTime,decodeSeekTime:decoded.seekTime,decodeVerification:decoded.verification});
      frames.push(frame);
      item.analysisProgress=(i+1)/targets.length;
      if(i%4===0||i===targets.length-1)renderWorkflow();
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(signal.aborted)return;
    const rom=analyzeRom(frames,arm,code,{gapFrames:item.gapFrames,gapSeconds:item.gapSeconds});
    item.birTrackingPoint='auto';
    Object.assign(item,{frames,rom,autoRom:structuredClone(rom),duration,videoWidth:video.videoWidth,videoHeight:video.videoHeight,expectedFrames:targets.length,missedFrames:missed,manualRepresentativeFrame:null,cirManualStartFrame:null,cirManualEndFrame:null,birManualSpineLevel:null,updatedAt:new Date().toISOString(),persistedOnly:false,snapshot:null});
    syncRepresentativeState(item);
    item.validation=validateAnalysis({frames,expectedFrames:targets.length,rom,motion:code,target:item.validationTarget,tolerance:item.validationTolerance});
    assignPhases(frames,rom);
    const representative=frames[item.finalRepresentativeFrame];
    if(representative) {
      const decoded=await seekDecodedFrame(video,representative.time,fps,{signal});
      if(signal.aborted)return;
      item.snapshot=captureSnapshot(representative,rom,{item,code,arm,video,decodedTime:decoded.mediaTime});
      item.snapshotSourceFrame=representative.index;
    }
  } finally {
    signal.removeEventListener('abort',abort);video.pause();video.removeAttribute('src');video.load();video.remove();
    if(engine.lowMemory)engine.reset();
  }
}
async function loadAnalysisVideo(video,url,signal) {
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(Error('영상을 불러오는 시간이 초과되었습니다.')),15000);
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',loaded);video.removeEventListener('error',failed);signal.removeEventListener('abort',cancel);};
    const finish=error=>{cleanup();error?reject(error):resolve();};
    const loaded=()=>finish();const failed=()=>finish(Error('지원하지 않거나 손상된 영상입니다. MP4(H.264)를 사용하세요.'));
    const cancel=()=>finish(new DOMException('취소','AbortError'));
    video.addEventListener('loadeddata',loaded,{once:true});video.addEventListener('error',failed,{once:true});signal.addEventListener('abort',cancel,{once:true});video.src=url;video.load();
  });
  if(!Number.isFinite(video.duration)) {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(Error('촬영 영상 길이를 읽지 못했습니다. 원본 저장 후 MP4로 변환하세요.')),8000);
      const finish=error=>{clearTimeout(timer);video.removeEventListener('durationchange',changed);error?reject(error):resolve();};
      const changed=()=>{if(Number.isFinite(video.duration))finish();};
      video.addEventListener('durationchange',changed);video.currentTime=1e10;
    });
    video.currentTime=0;
  }
}

function drawSkeleton(target, width, height, frame, selected = null, arm=measuredPrefix(),code=state.activeMotion) {
  const ids=visiblePointIds(arm,code);
  const visible = LANDMARKS.filter(item=>ids.includes(item.id));
  const visibleIds = new Set(visible.map(item => item.id));
  const connections = [...CONNECTIONS, ["left_wrist", "left_hand_tip"], ["right_wrist", "right_hand_tip"]]
    .filter(([startId, endId]) => visibleIds.has(startId) && visibleIds.has(endId));
  target.lineCap = "round";
  for (const [startId, endId] of connections) {
    const start = frame.corrected[startId];
    const end = frame.corrected[endId];
    if (!usable(start) || !usable(end)) continue;
    target.beginPath();
    target.moveTo(start.x * width, start.y * height);
    target.lineTo(end.x * width, end.y * height);
    target.strokeStyle = "rgba(53,224,190,.82)";
    target.lineWidth = Math.max(2, width / 430);
    target.stroke();
  }
  for (const item of visible) {
    const raw = frame.raw[item.id];
    const corrected = frame.corrected[item.id];
    if (!usable(corrected)) continue;
    const scale = Math.max(1, width / 900);
    target.beginPath();
    target.arc(raw.x * width, raw.y * height, 8 * scale, 0, Math.PI * 2);
    target.strokeStyle = "rgba(225,232,229,.9)";
    target.lineWidth = 2 * scale;
    target.stroke();
    target.beginPath();
    target.arc(corrected.x * width, corrected.y * height, item.id === selected ? 8 * scale : 6 * scale, 0, Math.PI * 2);
    target.fillStyle = item.id === selected ? "#b9e769" : "#35e0be";
    target.fill();
    target.strokeStyle = "rgba(6,42,35,.9)";
    target.stroke();
  }
}

function cirTrajectoryRows(untilIndex = Infinity) {
  if (state.activeMotion !== "CIR" || !session().rom) return [];
  const range=session().rom;
  return cirTrack(session().frames,measuredPrefix(),analysisOptions()).filter(row=>row.relative && row.index>=range.startFrameIndex && row.index<=range.endFrameIndex && row.index<=untilIndex).map(row=>({...row,frameIndex:row.index}));
}

function drawCirTrajectory(target, width, height, untilIndex = Infinity) {
  const rows = cirTrajectoryRows(untilIndex);
  if (!rows.length) return;
  const shoulderY = rows[0].shoulder.y * height;
  target.save();
  target.setLineDash([8, 7]);
  target.strokeStyle = "rgba(185,231,105,.72)";
  target.lineWidth = Math.max(1.5, width / 700);
  target.beginPath();
  target.moveTo(0, shoulderY);
  target.lineTo(width, shoulderY);
  target.stroke();
  target.setLineDash([]);
  target.strokeStyle = "rgba(255,183,77,.95)";
  target.lineWidth = Math.max(3, width / 320);
  target.beginPath();
  rows.forEach((row, index) => {
    const x = row.hand.x * width, y = row.hand.y * height;
    if (index === 0 || row.segment!==rows[index-1].segment) target.moveTo(x, y); else target.lineTo(x, y);
  });
  target.stroke();
  for (const [row, color] of [[rows[0], "#b9e769"], [rows.at(-1), "#ffb74d"]]) {
    target.beginPath();
    target.arc(row.hand.x * width, row.hand.y * height, Math.max(6, width / 150), 0, Math.PI * 2);
    target.fillStyle = color;
    target.fill();
    target.strokeStyle = "#102019";
    target.stroke();
  }
  target.restore();
}

function captureSnapshot(frame, rom, options={}) {
  const item=options.item??session(),video=options.video??elements.video,code=options.code??state.activeMotion,arm=options.arm??measuredPrefix();
  if (!item.videoUrl || video.readyState < 2) return null;
  if(Math.abs(video.currentTime-frame.time)>1/(item.sourceFps||30)) throw new Error('영상과 대표 좌표 시간이 다릅니다. 다시 저장해 주세요.');
  item.stillImageSourceFrame=frame.sourceFrame??frame.index;
  item.stillImageTime=frame.time;
  item.stillImageDecodeTime=video._verifiedMetadata?.mediaTime??null;
  item.stillImageSeekTime=video._verifiedMetadata?.seekTime??video.currentTime;
  item.stillImageDecodeVerification=video._verifiedMetadata?.verification??'unknown';
  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 720;
  const {width,height}=inferenceSize(sourceWidth,sourceHeight,960);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const imageCtx = canvas.getContext("2d");
  if (item.videoUrl && video.readyState >= 2) imageCtx.drawImage(video, 0, 0, width, height);
  else { imageCtx.fillStyle = "#101614"; imageCtx.fillRect(0, 0, width, height); }
  if(!options.item)drawCirTrajectory(imageCtx, width, height);
  drawSkeleton(imageCtx, width, height, frame,null,arm,code);
  imageCtx.fillStyle = "rgba(7,19,15,.78)";
  imageCtx.fillRect(14, 14, Math.min(width - 28, 370), 58);
  imageCtx.fillStyle = "#b9e769";
  imageCtx.font = "700 17px system-ui";
  imageCtx.fillText(`${patient().id} · ${code} · ${armName(arm)} ${primaryRomText(rom)}`, 28, 39);
  imageCtx.fillStyle = "#dbe8e3";
  imageCtx.font = "12px system-ui";
  const mode = item.representativeSelectionType === "manual" ? "수동 대표" : "자동 대표";
  const angle=shoulderAngles(frame.corrected)[arm];
  imageCtx.fillText(`원본 #${(frame.sourceFrame ?? frame.index) + 1} · ${frame.time.toFixed(3)}초 · ${mode} · 현재각 ${angle?.toFixed(1)??'—'}°`, 28, 59);
  const image=canvas.toDataURL("image/jpeg", 0.84);
  canvas.width=1;canvas.height=1;
  return image;
}

function resizeOverlay() {
  const {width,height}=inferenceSize(elements.video.videoWidth||1280,elements.video.videoHeight||720,1280);
  if (elements.overlay.width !== width || elements.overlay.height !== height) {
    elements.overlay.width = width;
    elements.overlay.height = height;
  }
  drawOverlay();
}

function drawCoordinateBackground(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#15241f");
  gradient.addColorStop(1, "#08100d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,.035)";
  for (let x = 0; x < width; x += Math.max(60, width / 16)) ctx.fillRect(x, 0, 1, height);
  for (let y = 0; y < height; y += Math.max(60, height / 10)) ctx.fillRect(0, y, width, 1);
  ctx.fillStyle = "rgba(255,255,255,.68)";
  ctx.font = `600 ${Math.max(14, width / 65)}px system-ui`;
  ctx.fillText("SAVED COORDINATES · video not stored", 26, 36);
}

function drawOverlay() {
  const width = elements.overlay.width;
  const height = elements.overlay.height;
  ctx.clearRect(0, 0, width, height);
  const frame = currentFrame();
  if (!frame) return;
  if (!session().videoUrl) drawCoordinateBackground(width, height);
  drawCirTrajectory(ctx, width, height, state.currentIndex);
  drawSkeleton(ctx, width, height, frame, state.selectedPoint);
}

async function selectFrame(index, seek = true) {
  const frames = session().frames;
  if (!frames.length) return;
  state.currentIndex = Math.max(0, Math.min(frames.length - 1, Number(index)));
  elements.slider.value = String(state.currentIndex);
  const frame = currentFrame();
  const requested=state.currentIndex,activeSession=session();
  if (seek && activeSession.videoUrl) {
    elements.video.pause();ctx.clearRect(0,0,elements.overlay.width,elements.overlay.height);
    try{await seekVideoFrame(frame.time);}catch(error){showToast(error.message);return;}
    if(requested!==state.currentIndex||activeSession!==session())return;
  }
  elements.currentTime.textContent = formatTime(frame.time);
  renderFramePanel();
  drawOverlay();
}

function renderFramePanel() {
  const frame = currentFrame();
  if (!frame) {
    elements.frameBadge.textContent = "프레임 —";
    elements.leftAngle.textContent = "—";
    elements.rightAngle.textContent = "—";
    elements.list.innerHTML = '<div class="blank-list">분석 결과가 여기에 표시됩니다.</div>';
    return;
  }
  const angles = shoulderAngles(frame.corrected);
  const edited = editedPointIds(frame);
  elements.frameBadge.textContent = `원본 #${(frame.sourceFrame ?? frame.index) + 1} · 분석 ${frame.index + 1}/${session().frames.length}`;
  elements.leftAngle.textContent = Number.isFinite(angles.left) ? `${angles.left.toFixed(1)}°` : "—";
  elements.rightAngle.textContent = Number.isFinite(angles.right) ? `${angles.right.toFixed(1)}°` : "—";
  elements.leftAngleCard.classList.toggle("measured", patient().arm === "left");
  elements.rightAngleCard.classList.toggle("measured", patient().arm === "right");
  elements.leftAngleCard.classList.toggle("hidden", isSideMotion() && patient().arm !== "left");
  elements.rightAngleCard.classList.toggle("hidden", isSideMotion() && patient().arm !== "right");
  elements.phase.value = frame.phase;
  elements.editCount.textContent = `보정 ${edited.length}개`;
  elements.list.innerHTML = "";
  const visible = visibleLandmarks();
  if (!visible.some(item => item.id === state.selectedPoint)) state.selectedPoint = visible[0]?.id ?? state.selectedPoint;
  for (const item of visible) {
    const point = frame.corrected[item.id];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `landmark-row${item.id === state.selectedPoint ? " active" : ""}${edited.includes(item.id) ? " edited" : ""}`;
    button.innerHTML = `<i class="joint-dot"></i><strong>${item.label.replace('손끝','엄지 끝')}</strong><span>${usable(point)?`${point.x.toFixed(3)}, ${point.y.toFixed(3)}`:'미검출 · 직접 지정'}</span>`;
    button.addEventListener("click", () => { state.selectedPoint = item.id; renderFramePanel(); drawOverlay(); });
    elements.list.appendChild(button);
  }
  const item = LANDMARKS.find(value => value.id === state.selectedPoint);
  const raw = frame.raw[item.id];
  const corrected = frame.corrected[item.id];
  elements.selectedName.textContent = item.label;
  elements.rawX.value = raw.x.toFixed(4);
  elements.rawY.value = raw.y.toFixed(4);
  elements.correctedX.value = corrected.x.toFixed(4);
  elements.correctedY.value = corrected.y.toFixed(4);
  elements.correctedX.disabled = false;
  elements.correctedY.disabled = false;
}

function recalculateAllRom() {
  if (!patient().arm) return;
  for (const code of MOTIONS) {
    const item = state.sessions[code];
    if (item.frames.length) {
      item.rom = analyzeRom(item.frames, patient().arm, code, analysisOptions(item));
      syncRepresentativeState(item);
    }
  }
}

function recalculateCurrentRom() {
  const activeSession = session();
  activeSession.snapshot=null;
  if (activeSession.frames.length && patient().arm) {
    activeSession.rom = analyzeRom(activeSession.frames, patient().arm, state.activeMotion, analysisOptions(activeSession));
    syncRepresentativeState(activeSession);
    activeSession.validation=validateAnalysis({frames:activeSession.frames,expectedFrames:activeSession.expectedFrames,rom:activeSession.rom,motion:state.activeMotion,target:activeSession.validationTarget,tolerance:activeSession.validationTolerance});
  }
}

function renderRepresentativeTools() {
  const item = session();
  const finalIndex = representativeIndex(item);
  const finalFrame = Number.isInteger(finalIndex) ? item.frames[finalIndex] : null;
  const mode = item.representativeSelectionType === "manual" ? "수동 선택" : "자동 선택";
  elements.representativeStatus.textContent = finalFrame
    ? `${mode} · 분석 #${finalIndex + 1} · 원본 #${(finalFrame.sourceFrame ?? finalIndex) + 1}`
    : "대표 프레임 —";
  elements.restoreRepresentative.disabled = !Number.isInteger(item.manualRepresentativeFrame);
  elements.cirRangeActions.hidden = state.activeMotion !== "CIR";
  if (state.activeMotion === "CIR" && item.rom) {
    const start = item.frames[item.rom.startFrameIndex];
    const end = item.frames[item.rom.endFrameIndex];
    elements.setCirStart.textContent = `시작 ${(start?.sourceFrame ?? item.rom.startFrameIndex) + 1}`;
    elements.setCirEnd.textContent = `종료 ${(end?.sourceFrame ?? item.rom.endFrameIndex) + 1}`;
  }
}

function renderMotionDetail() {
  const rom = session().rom;
  elements.motionDetail.hidden = !rom || !["BIR", "CIR"].includes(state.activeMotion);
  if (!rom) return;
  if (state.activeMotion === "BIR") {
    const reach = session().frames[rom.maxReachFrameIndex];
    const elbow = session().frames[rom.minElbowFrameIndex];
    elements.detailALabel.textContent = "척추 최대 높이";
    elements.detailAValue.textContent = rom.primaryValue;
    elements.detailAMeta.textContent = `${spineLevelMeaning(rom.primaryValue)} · ${rom.trackedPoint} · 원본 #${(reach?.sourceFrame ?? rom.maxReachFrameIndex) + 1}`;
    elements.detailBLabel.textContent = "팔꿈치 최소각도";
    elements.detailBValue.textContent = `${rom.minElbowAngle?.toFixed(1)??'—'}°`;
    elements.detailBMeta.textContent = `원본 #${(elbow?.sourceFrame ?? rom.minElbowFrameIndex) + 1}`;
  } else if(state.activeMotion==='CIR') {
    elements.detailALabel.textContent = "회전 분석 구간";
    elements.detailAValue.textContent = `${rom.startFrameIndex + 1}–${rom.endFrameIndex + 1}`;
    elements.detailAMeta.textContent = `${rom.trackedPoint} · 검출 ${rom.handDetectionRate.toFixed(1)}%`;
    elements.detailBLabel.textContent = "폐합 오차 / 흔들림";
    elements.detailBValue.textContent = `${rom.closureError.toFixed(1)}% / ${rom.wobbleIndex.toFixed(1)}%`;
    elements.detailBMeta.textContent = `${rom.direction} · 회전 ${rom.coverageDegrees.toFixed(0)}°`;
  }
}

function renderRomFocus() {
  const rom = session().rom;
  elements.romLabel.textContent = rom?.primaryLabel ?? `${armName()} ROM`;
  elements.romValue.textContent = primaryRomText(rom);
  elements.romDetail.textContent = rom?.secondaryLabel ?? "분석 전";
}

function renderMotionResultStrip() {
  elements.motionResultStrip.innerHTML = "";
  for (const code of MOTIONS) {
    const item = state.sessions[code];
    const definition = MOTION_DEFINITIONS[code];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `motion-result-item${code === state.activeMotion ? " active" : ""}`;
    const title=document.createElement('span'),value=document.createElement('strong'),detail=document.createElement('small');
    title.textContent=`${code} · ${definition.name}`;value.textContent=primaryRomText(item.rom);detail.textContent=item.rom?.secondaryLabel??'분석 전';button.append(title,value,detail);
    button.addEventListener("click", () => { if(state.view==='detail'){showToast('현재 수정 내용을 반영하거나 취소한 뒤 다른 동작을 선택하세요.');return;}selectMotion(code); });
    elements.motionResultStrip.appendChild(button);
  }
}

function renderResults() {
  const activeSession = session();
  const frames = activeSession.frames;
  const summary = summarize(frames);
  const rom = activeSession.rom;
  elements.summaryRomLabel.textContent = rom?.primaryLabel ?? `${armName()} ROM`;
  elements.summaryRom.textContent = primaryRomText(rom);
  elements.summaryRomDetail.textContent = rom?.secondaryLabel ?? "현재 동작 분석 전";
  let maxIndex = rom?.maxFrameIndex, minIndex = rom?.minFrameIndex;
  elements.summaryMaxLabel.textContent = "최대각";
  elements.summaryMinLabel.textContent = "최소각";
  elements.summaryMax.textContent = rom ? `${rom.maxAngle?.toFixed(1)??'—'}°` : "—";
  elements.summaryMin.textContent = rom ? `${rom.minAngle?.toFixed(1)??'—'}°` : "—";
  if (rom && state.activeMotion === "BIR") {
    maxIndex = rom.maxReachFrameIndex;
    minIndex = rom.minElbowFrameIndex;
    elements.summaryMaxLabel.textContent = "척추 최대 높이";
    elements.summaryMinLabel.textContent = "팔꿈치 최소각도";
    elements.summaryMax.textContent = rom.primaryValue;
    elements.summaryMin.textContent = `${rom.minElbowAngle?.toFixed(1)??'—'}°`;
  } else if (rom && state.activeMotion === "CIR") {
    maxIndex = rom.endFrameIndex;
    minIndex = rom.startFrameIndex;
    elements.summaryMaxLabel.textContent = "회전 범위";
    elements.summaryMinLabel.textContent = "궤적 흔들림";
    elements.summaryMax.textContent = `${rom.coverageDegrees.toFixed(0)}°`;
    elements.summaryMin.textContent = `${rom.wobbleIndex.toFixed(1)}%`;
  }
  const maxFrame = Number.isInteger(maxIndex) ? frames[maxIndex] : null;
  const minFrame = Number.isInteger(minIndex) ? frames[minIndex] : null;
  elements.summaryMaxTime.textContent = maxFrame ? `${maxFrame.time.toFixed(3)}초 · 원본 프레임 ${(maxFrame.sourceFrame ?? maxFrame.index) + 1}` : "최대 프레임 —";
  elements.summaryMinTime.textContent = minFrame ? `${minFrame.time.toFixed(3)}초 · 원본 프레임 ${(minFrame.sourceFrame ?? minFrame.index) + 1}` : "최소 프레임 —";
  elements.summaryQuality.textContent = summary.quality == null ? "—" : `${Math.round(summary.quality * 100)}%`;
  elements.summaryFrames.textContent = `분석 프레임 ${summary.frameCount}개`;
  elements.chartTitle.textContent = state.activeMotion === "CIR" ? `${armName()} 엄지 끝 궤적 (손목 대체 없음)` : `${armName()} 어깨각 변화`;
  elements.chartLegend.hidden = state.activeMotion === "CIR";
  renderMotionDetail();
  renderRepresentativeTools();
  renderMotionResultStrip();
  renderChart(frames);
  renderSnapshot();
  renderTable(frames);
  renderRomFocus();
  renderValidation();
  updateMotionCards();
  renderAdvanced();
  setFrameControls(frames.length > 0);
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(svgNs, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function renderChart(frames) {
  elements.chart.innerHTML = "";
  if (!frames.length) {
    elements.chart.innerHTML = '<div class="chart-empty">ROM 분석 결과가 준비되면 그래프가 표시됩니다.</div>';
    return;
  }
  if (state.activeMotion === "CIR") {
    renderCirChart();
    return;
  }
  const width = 760, height = 290, pad = { left: 44, right: 18, top: 16, bottom: 30 };
  const innerW = width - pad.left - pad.right, innerH = height - pad.top - pad.bottom;
  const maxTime = Math.max(1, ...frames.map(frame => frame.time));
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" });
  for (let angle = 0; angle <= 180; angle += 45) {
    const y = pad.top + innerH - (angle / 180) * innerH;
    svg.appendChild(svgNode("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, stroke: "#e5ece8", "stroke-width": 1 }));
    const label = svgNode("text", { x: pad.left - 9, y: y + 3, fill: "#718078", "font-size": 9, "text-anchor": "end" });
    label.textContent = `${angle}°`;
    svg.appendChild(label);
  }
  const measuredSide = patient().arm === "left" ? "left" : "right";
  const oppositeSide = measuredSide === "left" ? "right" : "left";
  const toPoints = side => frames.map(frame => {
    const value = shoulderAngles(frame.corrected)[side];
    const x = pad.left + (frame.time / maxTime) * innerW;
    const y = pad.top + innerH - (Math.max(0, Math.min(180, value)) / 180) * innerH;
    return value==null?null:`${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(" ");
  if(!isSideMotion())svg.appendChild(svgNode("polyline", { points: toPoints(oppositeSide), fill: "none", stroke: "#aeb9b4", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  svg.appendChild(svgNode("polyline", { points: toPoints(measuredSide), fill: "none", stroke: "#0f8b73", "stroke-width": 3.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  const rom = session().rom;
  for (const index of [rom?.minFrameIndex, rom?.maxFrameIndex].filter(Number.isInteger)) {
    const frame = frames[index];
    const value = shoulderAngles(frame.corrected)[measuredSide];
    const x = pad.left + (frame.time / maxTime) * innerW;
    const y = pad.top + innerH - (value / 180) * innerH;
    svg.appendChild(svgNode("circle", { cx: x, cy: y, r: 5, fill: index === rom.maxFrameIndex ? "#d98a25" : "#b9e769", stroke: "#fff", "stroke-width": 2 }));
  }
  for (let step = 0; step <= 4; step += 1) {
    const time = (maxTime / 4) * step;
    const x = pad.left + (innerW / 4) * step;
    const label = svgNode("text", { x, y: height - 8, fill: "#718078", "font-size": 9, "text-anchor": "middle" });
    label.textContent = `${time.toFixed(1)}s`;
    svg.appendChild(label);
  }
  elements.chart.appendChild(svg);
}

function renderCirChart() {
  const rows = cirTrajectoryRows();
  if (rows.length < 2) {
    elements.chart.innerHTML = '<div class="chart-empty">CIR 시작·종료 구간의 손끝 궤적이 필요합니다.</div>';
    return;
  }
  const width = 760, height = 290, pad = 24;
  const xs = rows.map(row => row.relative.x), ys = rows.map(row => row.relative.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const range = Math.max(maxX - minX, maxY - minY, 0.05);
  const scale = Math.min((width - pad * 2) / range, (height - pad * 2) / range);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const px = x => width / 2 + (x - cx) * scale;
  const py = y => height / 2 + (y - cy) * scale;
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}` });
  const guideY = py(0);
  svg.appendChild(svgNode("line", { x1: pad, x2: width - pad, y1: guideY, y2: guideY, stroke: "#9ab1a7", "stroke-dasharray": "7 6" }));
  const metrics=session().rom;
  if(metrics?.center&&metrics.meanRadius)svg.appendChild(svgNode('circle',{cx:px(metrics.center.x),cy:py(metrics.center.y),r:metrics.meanRadius*scale,fill:'none',stroke:'#9caab3','stroke-dasharray':'5 4','stroke-width':1.5}));
  for(let i=1;i<rows.length;i++) {
    const a=rows[i-1],b=rows[i];if(a.segment!==b.segment)continue;
    const interpolated=a.status==='interpolated'||b.status==='interpolated';
    svg.appendChild(svgNode('line',{x1:px(a.relative.x),y1:py(a.relative.y),x2:px(b.relative.x),y2:py(b.relative.y),stroke:interpolated?'#d78b26':b.status==='manual'?'#7759b2':'#0f8b73','stroke-width':3,'stroke-dasharray':interpolated?'4 3':'none'}));
  }
  [[rows[0], "#b9e769"], [rows.at(-1), "#ffb74d"]].forEach(([row, fill]) => {
    svg.appendChild(svgNode("circle", { cx: px(row.relative.x), cy: py(row.relative.y), r: 7, fill, stroke: "#fff", "stroke-width": 2 }));
  });
  elements.chart.appendChild(svg);
  const legend=document.createElement('p');legend.className='helper';legend.textContent='초록: 직접 검출 · 보라: 수동 지정 · 주황 점선: 짧은 공백 보간 · 회색 원: 원 적합 · 연두 점: 시작 / 주황 점: 종료 · 가로 점선: 어깨 높이';elements.chart.appendChild(legend);
}

function renderSnapshot() {
  const snapshot = session().snapshot;
  if (!snapshot) {
    elements.snapshotWrap.innerHTML = '<div class="chart-empty">분석 후 최대 ROM 프레임이 저장됩니다.</div>';
    elements.downloadSnapshot.disabled = true;
    elements.snapshotMeta.textContent = "자동 대표 프레임";
    return;
  }
  elements.snapshotWrap.innerHTML = "";
  const image = document.createElement("img");
  image.src = snapshot;
  image.alt = `${state.activeMotion} 최대 ROM 대표 이미지`;
  elements.snapshotWrap.appendChild(image);
  const frame = session().frames[session().snapshotSourceFrame];
  const mode = session().representativeSelectionType === "manual" ? "수동 대표" : "자동 대표";
  elements.snapshotMeta.textContent = frame ? `${mode} · 원본 #${(frame.sourceFrame ?? frame.index) + 1} · ${frame.time.toFixed(3)}초 · ${session().frameMapping==='estimated-fps'?'프레임 번호 추정':'원본 시간표'}` : mode;
  elements.downloadSnapshot.disabled = false;
}

function renderTable(frames) {
  const totalPages = Math.max(1, Math.ceil(frames.length / state.pageSize));
  state.page = Math.max(1, Math.min(totalPages, state.page));
  const pageFrames = frames.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  elements.resultsBody.innerHTML = "";
  if (!pageFrames.length) {
    elements.resultsBody.innerHTML = '<tr><td colspan="8" class="empty-cell">현재 동작의 분석 데이터가 없습니다.</td></tr>';
  } else {
    const measured = patient().arm === "left" ? "left" : "right";
    const opposite = measured === "left" ? "right" : "left";
    for (const frame of pageFrames) {
      const angles = shoulderAngles(frame.corrected);
      const edited = editedPointIds(frame).length;
      const row = document.createElement("tr");
      row.innerHTML = `<td>${(frame.sourceFrame ?? frame.index) + 1}</td><td>${frame.time.toFixed(3)}s</td><td>${frame.motion}</td><td>${frame.phase}</td><td><strong>${angles[measured]?.toFixed(1) ?? "—"}°</strong></td><td>${angles[opposite]?.toFixed(1) ?? "—"}°</td><td><span class="quality${frame.quality < .55 ? " low" : ""}"><i></i>${Math.round(frame.quality * 100)}%</span></td><td>${edited ? `${edited}개` : "—"}</td>`;
      row.addEventListener("click", () => { selectFrame(frame.index); document.querySelector(".workspace-grid").scrollIntoView({ behavior: "smooth", block: "start" }); });
      elements.resultsBody.appendChild(row);
    }
  }
  elements.tableCount.textContent = `${frames.length}행`;
  elements.pageLabel.textContent = `${state.page} / ${totalPages}`;
  elements.pagePrev.disabled = state.page <= 1;
  elements.pageNext.disabled = state.page >= totalPages;
}

function renderAll() {
  renderFramePanel();
  renderResults();
  resizeOverlay();
}

function updateCoordinate(axis, rawValue) {
  const frame = currentFrame();
  if (!frame) return;
  const value = Math.max(0, Math.min(1, Number(rawValue)));
  if (!Number.isFinite(value)) return;
  frame.corrected[state.selectedPoint][axis] = value;
  frame.corrected[state.selectedPoint].status='manual';
  recalculateCurrentRom();
  renderAll();
}

function pointerPosition(event) {
  const rect = elements.overlay.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}

function nearestPoint(position) {
  const frame = currentFrame();
  if (!frame) return null;
  let nearest = null;
  let distance = Infinity;
  for (const item of visibleLandmarks()) {
    const point = frame.corrected[item.id];
    const currentDistance = Math.hypot(point.x - position.x, point.y - position.y);
    if (currentDistance < distance) { nearest = item.id; distance = currentDistance; }
  }
  return distance <= 0.045 ? nearest : null;
}

function patientPayload() {
  const measurements = {};
  for (const code of MOTIONS) {
    const item = state.sessions[code];
    measurements[code] = {
      ...auditFields(item,item.measuredArm||patient().arm,code),
      autoRom:item.autoRom, birManualSpineLevel:item.birManualSpineLevel, birTrackingPoint:item.birTrackingPoint,
      analysisStatus:item.analysisStatus,analysisError:item.analysisError,videoWidth:item.videoWidth,videoHeight:item.videoHeight,
      stillImageDecodeVerification:item.stillImageDecodeVerification,stillImageSeekTime:item.stillImageSeekTime,
      frameTimes:item.frameTimes, frameMapping:item.frameMapping, cameraSettings:item.cameraSettings, gapFrames:item.gapFrames, gapSeconds:item.gapSeconds,
      motion: MOTION_DEFINITIONS[code], fileName: item.fileName, fileSize: item.fileSize,
      duration: item.duration, sourceFps: item.sourceFps, frameStep: item.frameStep,
      frames: item.frames, rom: item.rom, expectedFrames: item.expectedFrames,
      cirTrackingSamples:code==='CIR'?cirTrack(item.frames,item.measuredArm||patient().arm,analysisOptions(item)).map(row=>({analysisIndex:row.index,sourceFrame:row.sourceFrame,time:row.time,status:row.status,point:row.hand,normalized:row.relative,segment:row.segment??null})):null,
      missedFrames: item.missedFrames, validation: item.validation,
      validationTarget: item.validationTarget, validationTolerance: item.validationTolerance,
      snapshot: item.snapshot, updatedAt: item.updatedAt,
      autoRepresentativeFrame: item.autoRepresentativeFrame,
      manualRepresentativeFrame: item.manualRepresentativeFrame,
      finalRepresentativeFrame: item.finalRepresentativeFrame,
      representativeSelectionType: item.representativeSelectionType,
      snapshotSourceFrame: item.snapshotSourceFrame,
      cirManualStartFrame: item.cirManualStartFrame,
      cirManualEndFrame: item.cirManualEndFrame,
      displayMeasuredArmOnly: false, hideOppositeArm: ["FE", "ER", "CIR"].includes(code)
    };
  }
  return {
    schemaVersion: "4.0", patient: patient(), measurements,
    privacy: "videos_processed_locally_and_not_persisted", updatedAt: new Date().toISOString()
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("shoulder-rom-lab", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("patients")) db.createObjectStore("patients", { keyPath: "patient.id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("patients", "readwrite");
    transaction.objectStore("patients").put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function dbGet(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("patients").objectStore("patients").get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("patients").objectStore("patients").getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

async function refreshSavedPatientList(selectedId = "") {
  try {
    const records = await dbGetAll();
    records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    elements.savedPatients.innerHTML = '<option value="">저장 환자 선택</option>';
    for (const record of records) {
      const option = document.createElement("option");
      option.value = record.patient.id;
      option.textContent = `${record.patient.id}${record.patient.name ? ` · ${record.patient.name}` : ""} · ${record.patient.age}세`;
      elements.savedPatients.appendChild(option);
    }
    if (selectedId) elements.savedPatients.value = selectedId;
  } catch { /* IndexedDB may be disabled in private browser mode. */ }
}

async function regenerateCurrentSnapshot() {
  const item=session(),code=state.activeMotion,arm=item.measuredArm||measuredPrefix(),index=representativeIndex(item);
  if(!item.videoUrl||!Number.isInteger(index)||!item.frames[index])return;
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.className='analysis-decoder';document.body.appendChild(video);
  try {
    await loadAnalysisVideo(video,item.videoUrl,new AbortController().signal);
    const decoded=await seekDecodedFrame(video,item.frames[index].time,item.sourceFps);
    item.snapshot=captureSnapshot(item.frames[index],item.rom,{item,code,arm,video,decodedTime:decoded.mediaTime});
    item.snapshotSourceFrame=index;
  }finally{video.pause();video.removeAttribute('src');video.load();video.remove();}
}

async function applyRepresentativeFrame(index, manual = true) {
  const activeSession = session();
  if (!activeSession.frames[index]) return;
  activeSession.manualRepresentativeFrame = manual ? index : null;
  syncRepresentativeState(activeSession);
  const finalIndex = representativeIndex(activeSession);
  if (activeSession.videoUrl && Number.isInteger(finalIndex)) {
    await seekVideoFrame(activeSession.frames[finalIndex].time);
  }
  if (Number.isInteger(finalIndex)) {
    activeSession.snapshot = captureSnapshot(activeSession.frames[finalIndex], activeSession.rom);
    activeSession.snapshotSourceFrame = finalIndex;
  }
  selectFrame(finalIndex ?? 0);
  renderResults();
}

function revokeSessionUrls() {
  for (const item of Object.values(state.sessions)) if (item.videoUrl) URL.revokeObjectURL(item.videoUrl);
}

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportBaseName(suffix = "") {
  const id = patient().id || "patient";
  return `${id}-${state.activeMotion}${suffix}-${new Date().toISOString().slice(0, 10)}`;
}

function temporaryPatientId() {
  const now = new Date();
  const part = value => String(value).padStart(2, "0");
  return `TEMP-${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
}

function readMotionImages() {
  try { return JSON.parse(localStorage.getItem("shoulder-rom-lab:motion-images") || "{}"); }
  catch { return {}; }
}

function applyMotionImages() {
  const images = readMotionImages();
  for (const card of elements.motionCards) {
    const custom = images[card.dataset.motion];
    if (custom) card.querySelector(".motion-image").src = custom;
  }
}

function resizeMotionImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 720 / image.naturalWidth, 450 / image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없습니다.")); };
    image.src = url;
  });
}

let boundPatient=null;
function setPatient(value) {
  elements.patientId.value=value.id??'';elements.patientName.value=value.name??'';elements.patientGender.value=value.gender??'';elements.patientAge.value=value.age??'';
  elements.armInputs.forEach(input=>input.checked=input.value===value.arm);
}
function guardPatientChange() {
  if(boundPatient && JSON.stringify(patient())!==JSON.stringify(boundPatient) && MOTIONS.some(code=>state.sessions[code].fileName)) {
    if(!confirm('환자 또는 측정 팔을 바꾸면 새 측정을 시작합니다. 저장하지 않은 결과는 사라집니다. 필요한 결과를 JSON/환자 저장으로 보관하셨나요?')) {setPatient(boundPatient);return;}
    queue.cancelAll();engine.reset();revokeSessionUrls();state.sessions=Object.fromEntries(MOTIONS.map(code=>[code,emptySession()]));state.draft=null;setView('capture');selectMotion(state.activeMotion);
  }
  boundPatient=patient();updatePatientGate();renderAll();
}
for (const input of [elements.patientId, elements.patientName, elements.patientGender, elements.patientAge, ...elements.armInputs]) input.addEventListener('change',guardPatientChange);

elements.temporaryPatient.addEventListener("click", () => {
  if(MOTIONS.some(code=>state.sessions[code].fileName)){showToast('먼저 새 측정을 선택해 기존 결과를 정리하세요.');return;}
  elements.patientId.value = temporaryPatientId();
  elements.patientName.value = "임시환자";
  elements.patientGender.value = "기타";
  elements.patientAge.value = "30";
  elements.armInputs.forEach(input => { input.checked = input.value === "right"; });
  updatePatientGate();
  showToast("임시환자 정보가 입력되었습니다. 필요한 항목은 수정할 수 있습니다.");
});

for (const card of elements.motionCards) card.addEventListener("click", () => selectMotion(card.dataset.motion));

elements.sourceFps.addEventListener("change", () => {
  const value = normalizeFps(elements.sourceFps.value);
  elements.sourceFps.value = String(value);
  session().sourceFps = value;
});
elements.frameStep.addEventListener("change", () => {
  const value = Math.max(1, Math.min(30, Math.round(Number(elements.frameStep.value) || 1)));
  elements.frameStep.value = String(value);
  session().frameStep = value;
});
elements.validationTarget.addEventListener("change", () => {
  session().validationTarget = elements.validationTarget.value.trim();
});
elements.validationTolerance.addEventListener("change", () => {
  const value = Math.max(0, Number(elements.validationTolerance.value) || 0);
  elements.validationTolerance.value = String(value);
  session().validationTolerance = value;
});

elements.motionImageInput.addEventListener("change", async () => {
  const file = elements.motionImageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { showToast("이미지 파일을 선택해 주세요."); return; }
  try {
    const dataUrl = await resizeMotionImage(file);
    const images = readMotionImages();
    images[state.activeMotion] = dataUrl;
    localStorage.setItem("shoulder-rom-lab:motion-images", JSON.stringify(images));
    applyMotionImages();
    showToast(`${state.activeMotion} 동작 이미지를 변경했습니다.`);
  } catch (error) { showToast(error.message || "이미지 저장에 실패했습니다."); }
  finally { elements.motionImageInput.value = ""; }
});

async function loadVideoFile(file, cameraSettings=null) {
  if (!file) return;
  if (!patientValid()) { showToast("환자 필수정보를 먼저 입력해 주세요."); return; }
  if (!file.type.startsWith("video/")&&!/\.(mov|mp4|webm)$/i.test(file.name)) { showToast("영상 파일을 선택해 주세요."); return; }
  const requestedCode=state.activeMotion,requestedPatient=JSON.stringify(patient());
  uploadFeedback(`${requestedCode} · 영상 정보를 확인하고 있습니다.`);
  rememberUpload('파일 확인');
  const info=await inspectVideo(file);
  if(requestedCode!==state.activeMotion||requestedPatient!==JSON.stringify(patient())){showToast('영상 정보를 읽는 동안 선택이 변경되었습니다. 해당 동작에서 다시 등록하세요.');return;}
  if(session().frames.length && session().fileName===file.name && session().fileSize===file.size && !session().videoUrl) {
    if(confirm('저장 결과와 같은 원본 파일입니다. 보정 결과를 유지하고 영상만 다시 연결할까요?')) {
      session().videoUrl=URL.createObjectURL(file);session().persistedOnly=false;session().loadToken=crypto.randomUUID();selectMotion(state.activeMotion);return;
    }
  }
  if(session().frames.length&&!confirm('이 동작의 기존 결과를 새 영상으로 교체할까요? 저장하지 않은 보정은 사라집니다.'))return;
  const code = state.activeMotion;
  const previous = session();
  queue.cancel(code);
  stopCoordinatePlayback();
  elements.video.pause();
  setProgress(false);
  if (previous.videoUrl) URL.revokeObjectURL(previous.videoUrl);
  const activeSession = {
    ...emptySession(), sourceFps: Number(elements.sourceFps.value) || previous.sourceFps || 30,
    frameStep: Number(elements.frameStep.value) || 1,
    validationTarget: elements.validationTarget.value.trim(),
    validationTolerance: Number(elements.validationTolerance.value) || 0,
    loadToken: `${Date.now()}-${Math.random().toString(36).slice(2)}`
  };
  Object.assign(activeSession,info,{sourceFps:info.sourceFps||cameraSettings?.frameRate||activeSession.sourceFps,cameraSettings,measuredArm:patient().arm});
  boundPatient=patient();
  elements.sourceFps.value=String(activeSession.sourceFps);
  state.sessions[code] = activeSession;
  state.currentIndex = 0;
  state.page = 1;
  activeSession.videoUrl = URL.createObjectURL(file);
  activeSession.fileName = file.name;
  activeSession.fileSize = file.size;
  queue.enqueue(code,activeSession);
  elements.video.dataset.motion = code;
  elements.video.dataset.loadToken = activeSession.loadToken;
  clearVideoElement();
  if(!engine.lowMemory){elements.video.src = activeSession.videoUrl;elements.video.load();}
  elements.stage.classList.remove("empty");
  elements.analyze.disabled = true;
  setFrameControls(false);
  updateMotionCards();
  renderResults();
  renderValidation();
  elements.status.textContent = `${code} 분석 대기 · 다른 동작의 영상을 선택할 수 있습니다.`;
  uploadFeedback(`${code} 영상 등록 완료. 분석은 이 화면에서 계속 진행됩니다.${engine.lowMemory?' iOS에서는 분석 중 미리보기를 쉬어 메모리 사용을 줄입니다.':''}`);
  rememberUpload('분석');
  elements.upload.value = "";
}
const uploadRecoveryKey='shoulder-upload-recovery-v1';
function uploadFeedback(message){$('#upload-feedback').textContent=message;}
function rememberUpload(stage){try{window.sessionStorage.setItem(uploadRecoveryKey,JSON.stringify({patient:patient(),motion:state.activeMotion,stage,time:Date.now()}));}catch{/* Storage may be disabled. Upload remains available. */}}
function clearUploadRecovery(){try{window.sessionStorage.removeItem(uploadRecoveryKey);}catch{}}
elements.upload.addEventListener('click',()=>{rememberUpload('영상 선택');});
elements.upload.addEventListener('cancel',()=>{if(!queue.running)clearUploadRecovery();});
elements.upload.addEventListener('change',async()=>{
  const file=elements.upload.files?.[0];elements.upload.value='';
  try{await loadVideoFile(file);}catch(error){showToast(error.message);elements.status.textContent=error.message;uploadFeedback(error.message);}
});

elements.video.addEventListener("loadedmetadata", async () => {
  if (elements.video.dataset.motion !== state.activeMotion || !session().videoUrl || elements.video.dataset.loadToken !== session().loadToken) return;
  const activeSession = session();
  if (!Number.isFinite(elements.video.duration)) {
    const video=elements.video;
    try {await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{video.removeEventListener('durationchange',changed);reject(Error('촬영 영상의 길이를 읽지 못했습니다. 원본을 저장 후 다시 업로드하세요.'));},5000);const changed=()=>{if(Number.isFinite(video.duration)){clearTimeout(timeout);video.removeEventListener('durationchange',changed);resolve();}};video.addEventListener('durationchange',changed);video.currentTime=1e10;});video.currentTime=0;}catch(error){elements.status.textContent=error.message;return;}
  }
  activeSession.duration = activeSession.frameTimes?.length ? activeSession.duration : elements.video.duration;
  activeSession.videoWidth=elements.video.videoWidth;activeSession.videoHeight=elements.video.videoHeight;
  elements.stage.style.aspectRatio = `${elements.video.videoWidth || 16} / ${elements.video.videoHeight || 9}`;
  elements.durationTime.textContent = formatTime(elements.video.duration);
  elements.currentTime.textContent = formatTime(0);
  elements.analyze.disabled = !patientValid();
  resizeOverlay();
  elements.status.textContent = `${state.activeMotion} · ${activeSession.fileName} · ${elements.video.videoWidth}×${elements.video.videoHeight} · ${activeSession.duration.toFixed(1)}초 · ${activeSession.frameTimes?.length ? '원본 프레임 시간표 확인' : 'FPS 추정: 원본 프레임 번호는 근사치'}`;
});

elements.video.addEventListener("error", () => {
  if (!session().videoUrl) return;
  elements.status.textContent = "영상을 열 수 없습니다. MP4(H.264) 또는 WebM 형식을 사용해 주세요.";
  elements.analyze.disabled = true;
});

elements.video.addEventListener("play", () => { elements.play.textContent = "Ⅱ"; animationLoop(); });
elements.video.addEventListener("pause", () => { if (!state.coordinatePlaybackTimer) elements.play.textContent = "▶"; });
elements.video.addEventListener("ended", () => { elements.play.textContent = "▶"; });

function animationLoop() {
  if (elements.video.paused || !session().videoUrl) return;
  const index = nearestFrameIndex(elements.video.currentTime);
  if (index !== state.currentIndex) selectFrame(index, false);
  elements.currentTime.textContent = formatTime(elements.video.currentTime);
  drawOverlay();
  requestAnimationFrame(animationLoop);
}

elements.analyze.addEventListener("click", analyzeVideo);
elements.play.addEventListener("click", () => {
  if (session().videoUrl) {
    if (elements.video.paused) elements.video.play().catch(() => showToast("재생을 시작할 수 없습니다."));
    else elements.video.pause();
    return;
  }
  if (!session().frames.length) return;
  if (state.coordinatePlaybackTimer) { stopCoordinatePlayback(); return; }
  elements.play.textContent = "Ⅱ";
  const fps = Math.max(1, Math.min(120, session().sourceFps || session().sampleFps || 30));
  const playbackStep = Math.max(1, session().frameStep || 1);
  state.coordinatePlaybackTimer = setInterval(() => {
    if (state.currentIndex >= session().frames.length - 1) { stopCoordinatePlayback(); return; }
    selectFrame(state.currentIndex + 1, false);
  }, (1000 / fps) * playbackStep);
});
elements.prev.addEventListener("click", () => selectFrame(state.currentIndex - 1));
elements.next.addEventListener("click", () => selectFrame(state.currentIndex + 1));
elements.slider.addEventListener("input", event => selectFrame(event.target.value));
elements.phase.addEventListener("change", () => { const frame = currentFrame(); if (frame) { frame.phase = elements.phase.value; renderTable(session().frames); } });
elements.pagePrev.addEventListener("click", () => { state.page -= 1; renderTable(session().frames); });
elements.pageNext.addEventListener("click", () => { state.page += 1; renderTable(session().frames); });
elements.correctedX.addEventListener("change", event => updateCoordinate("x", event.target.value));
elements.correctedY.addEventListener("change", event => updateCoordinate("y", event.target.value));
elements.setRepresentative.addEventListener("click", async () => {
  try {
    await applyRepresentativeFrame(state.currentIndex, true);
    showToast(`현재 원본 프레임 ${(currentFrame()?.sourceFrame ?? state.currentIndex) + 1}을 대표 이미지로 선택했습니다.`);
  } catch (error) { showToast(error.message); }
});
elements.restoreRepresentative.addEventListener("click", async () => {
  try {
    await applyRepresentativeFrame(state.currentIndex, false);
    showToast("자동 대표 프레임으로 복원했습니다.");
  } catch (error) { showToast(error.message); }
});
elements.setCirStart.addEventListener("click", () => {
  const activeSession = session();
  if (state.activeMotion !== "CIR") return;
  if (Number.isInteger(activeSession.cirManualEndFrame) && state.currentIndex >= activeSession.cirManualEndFrame) {
    showToast("시작 프레임은 종료 프레임보다 앞이어야 합니다.");
    return;
  }
  activeSession.cirManualStartFrame = state.currentIndex;
  recalculateCurrentRom();
  renderResults();
  showToast("현재 프레임을 CIR 궤적 시작으로 지정했습니다.");
});
elements.setCirEnd.addEventListener("click", () => {
  const activeSession = session();
  if (state.activeMotion !== "CIR") return;
  const start = Number.isInteger(activeSession.cirManualStartFrame) ? activeSession.cirManualStartFrame : activeSession.rom?.startFrameIndex;
  if (Number.isInteger(start) && state.currentIndex <= start) {
    showToast("종료 프레임은 시작 프레임보다 뒤여야 합니다.");
    return;
  }
  activeSession.cirManualEndFrame = state.currentIndex;
  recalculateCurrentRom();
  renderResults();
  showToast("현재 프레임을 CIR 궤적 종료로 지정했습니다.");
});

elements.overlay.addEventListener("pointerdown", event => {
  const pointId = nearestPoint(pointerPosition(event));
  if (!pointId) return;
  state.dragPoint = pointId;
  state.selectedPoint = pointId;
  elements.overlay.setPointerCapture(event.pointerId);
  renderFramePanel();
  drawOverlay();
});
elements.overlay.addEventListener("pointermove", event => {
  if (!state.dragPoint) return;
  const position = pointerPosition(event);
  const frame = currentFrame();
  frame.corrected[state.dragPoint].x = Math.max(0, Math.min(1, position.x));
  frame.corrected[state.dragPoint].y = Math.max(0, Math.min(1, position.y));
  frame.corrected[state.dragPoint].status='manual';
  recalculateCurrentRom();
  renderFramePanel();
  drawOverlay();
  renderRomFocus();
});
function endDrag(event) {
  if (!state.dragPoint) return;
  state.dragPoint = null;
  if (elements.overlay.hasPointerCapture(event.pointerId)) elements.overlay.releasePointerCapture(event.pointerId);
  renderResults();
}
elements.overlay.addEventListener("pointerup", endDrag);
elements.overlay.addEventListener("pointercancel", endDrag);

elements.resetFrame.addEventListener("click", () => {
  const frame = currentFrame();
  if (!frame) return;
  frame.corrected = clonePoints(frame.raw);
  recalculateCurrentRom();
  renderAll();
  showToast("현재 프레임의 보정을 초기화했습니다.");
});

elements.savePatient.addEventListener("click", async () => {
  if (!patientValid()) { showToast("환자 필수정보를 확인해 주세요."); return; }
  try {
    elements.savePatient.disabled = true;
    await regenerateCurrentSnapshot();
    await dbPut(patientPayload());
    await refreshSavedPatientList(patient().id);
    renderResults();
    showToast("환자 기본정보·측정값·ROM 이미지를 저장했습니다.");
  } catch (error) {
    console.warn(error);
    showToast("브라우저 저장에 실패했습니다. JSON으로 내보내 주세요.");
  } finally {
    setFrameControls(session().frames.length > 0);
  }
});

elements.loadPatient.addEventListener("click", async () => {
  const id = elements.savedPatients.value;
  if (!id) { showToast("불러올 환자를 선택해 주세요."); return; }
  try {
    const record = await dbGet(id);
    if (!record) throw new Error("저장 환자를 찾을 수 없습니다.");
    if(MOTIONS.some(code=>state.sessions[code].fileName)&&!confirm('현재 측정을 닫고 저장 환자를 불러올까요? 저장하지 않은 변경은 사라집니다.'))return;
    queue.cancelAll();engine.reset();state.draft=null;
    revokeSessionUrls();
    elements.patientId.value = record.patient.id;
    elements.patientName.value = record.patient.name ?? "";
    elements.patientGender.value = record.patient.gender ?? "";
    elements.patientAge.value = record.patient.age ?? "";
    elements.armInputs.forEach(input => { input.checked = input.value === record.patient.arm; });
    boundPatient=patient();
    state.sessions = Object.fromEntries(MOTIONS.map(code => {
      const saved = record.measurements?.[code] ?? {};
      const restored = { ...emptySession(), ...saved, videoUrl: null, persistedOnly: Boolean(saved.frames?.length),analysisStatus:saved.frames?.length?(saved.rom?.valid===false?'review':'complete'):null };
      syncRepresentativeState(restored);
      return [code, restored];
    }));
    const firstWithData = MOTIONS.find(code => state.sessions[code].frames.length) ?? "AB";
    updatePatientGate();
    setView('results');
    selectMotion(firstWithData);
    showToast(`${record.patient.id} 환자 데이터를 불러왔습니다.`);
  } catch (error) { showToast(error.message); }
});

elements.exportJson.addEventListener("click", async () => {
  try {await regenerateCurrentSnapshot();}catch(error){showToast(error.message);return;}
  download(`${patient().id || "patient"}-shoulder-rom.json`, JSON.stringify(patientPayload(), null, 2), "application/json;charset=utf-8");
  showToast("환자 전체 측정 데이터를 JSON으로 내보냈습니다.");
});
elements.exportCsv.addEventListener("click", () => {
  download(`${exportBaseName("-rom")}.csv`, `\ufeff${framesToCsv(session().frames, patient(), session())}`, "text/csv;charset=utf-8");
  showToast(`${state.activeMotion} 좌표와 ROM 데이터를 CSV로 내보냈습니다.`);
});
elements.downloadSnapshot.addEventListener("click", async () => {
  try {await regenerateCurrentSnapshot();}catch(error){showToast(error.message);return;}
  const snapshot = session().snapshot;
  if (!snapshot) return;
  const anchor = document.createElement("a");
  anchor.href = snapshot;
  anchor.download = `${exportBaseName("-max-rom")}.jpg`;
  anchor.click();
});

function renderAdvanced() {
  const item=session(),r=item.rom;
  $('#bir-settings').hidden=state.activeMotion!=='BIR';$('#cir-settings').hidden=state.activeMotion!=='CIR';$('#restore-cir').hidden=state.activeMotion!=='CIR';
  $('#bir-tracking').value=item.birTrackingPoint||'auto';$('#bir-level').value=item.birManualSpineLevel||'';
  $('#gap-frames').value=item.gapFrames??5;$('#gap-seconds').value=item.gapSeconds??.2;
  $('#camera-guide-text').textContent=`${state.activeMotion} · ${MOTION_DEFINITIONS[state.activeMotion].view} · ${armName()} 전체와 몸통이 보이게 촬영`;
  const fmt=v=>Number.isFinite(v)?v.toFixed(1):'—';
  const sf=i=>Number.isInteger(i)?`#${(item.frames[i]?.sourceFrame??i)+1} (${item.frames[i]?.time?.toFixed(3)??'—'}초)`:'—';
  let lines=[`자동 대표 ${sf(item.autoRepresentativeFrame)} / 수동 ${sf(item.manualRepresentativeFrame)} / 최종 ${sf(item.finalRepresentativeFrame)}`];
  if(r&&state.activeMotion==='BIR')lines.push(`높이 지수 ${fmt(r.reachIndex)}% · 최대 높이 ${sf(r.maxReachFrameIndex)}\n팔꿈치 최소 ${fmt(r.minElbowAngle)}° · ${sf(r.minElbowFrameIndex)}`);
  if(r&&state.activeMotion==='CIR')lines.push(`자동 구간 ${sf(r.automaticStartFrameIndex)} → ${sf(r.automaticEndFrameIndex)}\n적용 구간 ${sf(r.startFrameIndex)} → ${sf(r.endFrameIndex)}\n직접 검출 ${fmt(r.handDetectionRate)}% · 수동 ${r.trackingCounts.manual} · 보간 ${r.trackingCounts.interpolated} · 미검출 ${r.trackingCounts.missing}\n반지름 평균/최소/최대 ${fmt(r.meanRadius)} / ${fmt(r.minRadius)} / ${fmt(r.maxRadius)} (몸통 길이=1)\n방향 일관성 ${fmt(r.directionConsistency)}% · 신뢰도 ${r.confidence} · 손목 대체 0\n${r.secondaryLabel}`);
  $('#analysis-audit').textContent=item.frames.length?lines.join('\n'):'';
}
const locks=new Map();
function lockWorkspace(locked) {
  if(locked){for(const el of document.querySelectorAll('button,input,select')){if(el.closest('#camera-panel')||el.id==='cancel-analysis')continue;if(!locks.has(el))locks.set(el,el.disabled);el.disabled=true;}}
  else {for(const [el,disabled]of locks)el.disabled=disabled;locks.clear();}
  $('#cancel-analysis').hidden=!state.busy;
}
$('#cancel-analysis').onclick=()=>{state.analysisId++;$('#cancel-analysis').disabled=true;elements.status.textContent='현재 프레임 처리가 끝나면 취소합니다. 이전 분석 결과는 유지됩니다.';};
$('#bir-level').onchange=()=>{session().birManualSpineLevel=$('#bir-level').value||null;recalculateCurrentRom();renderAll();};
$('#bir-tracking').onchange=()=>{session().birTrackingPoint=$('#bir-tracking').value;recalculateCurrentRom();renderAll();};
for(const id of ['gap-frames','gap-seconds'])$('#'+id).onchange=()=>{session().gapFrames=Math.max(0,Math.min(15,Math.round(Number($('#gap-frames').value)||0)));session().gapSeconds=Math.max(0,Math.min(.5,Number($('#gap-seconds').value)||0));recalculateCurrentRom();renderAll();};
$('#restore-cir').onclick=()=>{session().cirManualStartFrame=null;session().cirManualEndFrame=null;recalculateCurrentRom();renderAll();};
$('#refresh-snapshot').onclick=async()=>{try{await regenerateCurrentSnapshot();renderResults();showToast(session().snapshot?'대표 이미지를 동기화했습니다.':'원본 영상을 다시 연결한 뒤 대표 이미지를 저장하세요.');}catch(error){showToast(error.message);}};
$('#new-patient').onclick=()=>{
  clearUploadRecovery();
  if(MOTIONS.some(code=>state.sessions[code].fileName)&&!confirm('새 측정을 시작할까요? 저장하지 않은 결과는 지워집니다.'))return;
  camera.stop();queue.cancelAll();engine.reset();revokeSessionUrls();state.sessions=Object.fromEntries(MOTIONS.map(code=>[code,emptySession()]));state.draft=null;boundPatient=null;setPatient({});setView('capture');updatePatientGate();selectMotion('AB');
};
$('#delete-patient').onclick=async()=>{
  const id=elements.savedPatients.value;if(!id){showToast('삭제할 저장 환자를 선택하세요.');return;}
  if(!confirm(`${id}의 이 브라우저 저장 결과를 삭제할까요? JSON 백업이 없으면 복구할 수 없습니다.`))return;
  try{const db=await openDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction('patients','readwrite');tx.objectStore('patients').delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);});await refreshSavedPatientList();showToast('저장 기록을 삭제했습니다. 기존 JSON 백업이 있으면 복원할 수 있습니다.');}catch(error){showToast('삭제에 실패했습니다: '+error.message);}
};
function validateImport(data) {
  if(!['3.0','4.0'].includes(data.schemaVersion)||!data.patient?.id||!['left','right'].includes(data.patient.arm)||!data.measurements)throw Error('지원하는 Shoulder ROM Lab JSON이 아닙니다.');
  for(const [code,item] of Object.entries(data.measurements)){
    if(!MOTIONS.includes(code)||!Array.isArray(item.frames)||item.frames.length>30000)throw Error('동작/프레임 형식이 잘못되었습니다.');
    if(item.snapshot&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.snapshot))throw Error('잘못된 대표 이미지 형식입니다.');
    item.frames.forEach((frame,index)=>{if(frame.index!==index||!Number.isFinite(frame.time)||frame.time<0||!['미분류','준비','진입','최대ROM','복귀','완료'].includes(frame.phase)||frame.motion!==code)throw Error('프레임 데이터 검증 실패');for(const {id}of LANDMARKS)for(const type of ['raw','corrected']){const p=frame[type]?.[id];if(!p||![p.x,p.y].every(Number.isFinite)||Math.abs(p.x)>10||Math.abs(p.y)>10)throw Error('관절점 좌표 검증 실패');}});
  }
  return data;
}
$('#import-json').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>100*1024*1024)throw Error('JSON은 100 MB 이하여야 합니다.');const data=validateImport(JSON.parse(await file.text()));const existing=await dbGet(data.patient.id);if(existing&&!confirm('같은 환자번호의 저장 기록을 JSON 내용으로 교체할까요?'))return;await dbPut(data);await refreshSavedPatientList(data.patient.id);showToast('JSON을 복원했습니다. 불러오기를 눌러 확인하세요.');}catch(error){showToast(error.message);}finally{event.target.value='';}
};
function jobLabel(item) {
  return ({queued:'분석 대기',analyzing:'분석 중 '+Math.round((item.analysisProgress||0)*100)+'%',complete:'분석 완료',review:'수동 확인 필요',error:'분석 실패',cancelled:'분석 취소'})[item.analysisStatus]|| (item.frames.length?'저장 결과':'영상 미등록');
}
function setView(view) {
  state.view=view;document.body.dataset.view=view;
  $('#workflow-title').textContent=view==='capture'?'1. 영상 등록':view==='results'?'2. 최종 분석 결과':'3. 상세결과 · 관절점 수정';
  $('#back-upload').hidden=view!=='results';
  $('#final-analysis').hidden=view!=='capture';
  $('#discard-detail').hidden=view!=='detail';$('#apply-detail').hidden=view!=='detail';
  elements.video.pause();renderWorkflow();
  window.scrollTo({top:0,behavior:'smooth'});
}
function renderWorkflow() {
  const status=workflowStatus(state.sessions);
  $('#workflow-status').textContent=state.view==='detail'?'원본·자동값은 보존됩니다. 수정 후 반영하면 최종 결과에 적용됩니다.':status.uploaded+' / 5 동작 등록 · '+status.complete+' / 5 분석 처리 완료'+(status.pending.length?' · 다른 동작을 등록하는 동안에도 분석합니다.':'')+(status.errors.length?' · 실패한 동작은 다시 분석하세요.':'');
  $('#final-analysis').disabled=!status.canFinalize||!!state.cameraBusy;
  $('#job-list').replaceChildren();
  for(const code of MOTIONS) {
    const item=state.sessions[code],card=document.createElement('div');card.className='job-item'+(item.analysisStatus==='error'?' error':'');
    const title=document.createElement('b');title.textContent=code+' · '+MOTION_DEFINITIONS[code].name;
    const text=document.createElement('span');text.textContent=jobLabel(item);
    card.append(title,text);
    if(['queued','analyzing'].includes(item.analysisStatus)){const progress=document.createElement('progress');progress.max=1;progress.value=item.analysisProgress||0;progress.setAttribute('aria-label',code+' 분석 진행률');card.append(progress);}
    if(item.analysisError){const error=document.createElement('small');error.textContent=item.analysisError;card.append(error);}
    if(['error','cancelled'].includes(item.analysisStatus)&&item.videoUrl){const retry=document.createElement('button');retry.className='button ghost small';retry.textContent='다시 분석';retry.disabled=!!state.cameraBusy;retry.onclick=()=>queue.enqueue(code,item);card.append(retry);}
    $('#job-list').append(card);
  }
  updateMotionCards();
  if(state.view!=='capture')renderFinalSummary();
  if(!state.cameraBusy){elements.sourceFps.disabled=!!session().frameTimes?.length||['queued','analyzing'].includes(session().analysisStatus);elements.frameStep.disabled=['queued','analyzing'].includes(session().analysisStatus);}
}
function renderFinalSummary() {
  $('#final-summary').replaceChildren();
  for(const code of MOTIONS) {
    const item=state.sessions[code],card=document.createElement('article');card.className='final-motion';
    const title=document.createElement('h3');title.textContent=code+' · '+MOTION_DEFINITIONS[code].name;
    const value=document.createElement('strong');value.textContent=primaryRomText(item.rom);
    const detail=document.createElement('p');detail.textContent=item.analysisError||item.rom?.secondaryLabel||jobLabel(item);
    const button=document.createElement('button');button.className='button primary';button.textContent='상세결과 · 관절점 수정';button.disabled=!item.frames.length||['queued','analyzing'].includes(item.analysisStatus);button.onclick=()=>openDetail(code);
    card.append(title,value,detail,button);
    if(['error','cancelled'].includes(item.analysisStatus)){const retry=document.createElement('button');retry.className='button ghost';retry.textContent='다시 분석';retry.disabled=!item.videoUrl;retry.onclick=()=>queue.enqueue(code,item);card.append(retry);}
    $('#final-summary').append(card);
  }
}
function openDetail(code) {
  const item=state.sessions[code];if(!item.frames.length)return;
  state.draft=structuredClone(item);setView('detail');selectMotion(code);
}
function discardDetail() {
  if(!confirm('반영하지 않은 상세 수정 내용을 취소하고 결과로 돌아갈까요?'))return;
  state.draft=null;setView('results');selectMotion(state.activeMotion);renderResults();
}
async function applyDetail() {
  if(!state.draft)return;
  lockWorkspace(true);
  try {
    recalculateCurrentRom();await regenerateCurrentSnapshot();
    state.draft.updatedAt=new Date().toISOString();state.draft.analysisStatus=state.draft.rom?.valid?'complete':'review';
    state.sessions[state.activeMotion]=state.draft;state.draft=null;
    setView('results');renderResults();showToast('수정 내용을 최종 결과에 반영했습니다. 환자 저장 또는 JSON으로 보관하세요.');
  }catch(error){showToast('반영하지 못했습니다: '+error.message);}
  finally{lockWorkspace(false);setFrameControls(session().frames.length>0);}
}
const engine=new InferenceClient();
const queue=new AnalysisQueue(analyzeSession,()=>{
  renderWorkflow();
  if(!MOTIONS.some(code=>['queued','analyzing'].includes(state.sessions[code].analysisStatus)))clearUploadRecovery();
  if(state.view==='results')renderResults();
});
state.view='capture';state.draft=null;
$('#final-analysis').onclick=()=>{
  if(!workflowStatus(state.sessions).canFinalize)return;
  for(const code of MOTIONS){const item=state.sessions[code];if(!item.analysisStatus&&item.videoUrl)queue.enqueue(code,item);}
  setView('results');renderResults();
};
$('#back-upload').onclick=()=>{setView('capture');selectMotion(state.activeMotion);};
$('#discard-detail').onclick=discardDetail;
$('#apply-detail').onclick=applyDetail;
$('#save-final').onclick=()=>elements.savePatient.click();
const camera=setupCamera({getContext:()=>({valid:patientValid(),motion:state.activeMotion,arm:patient().arm,patientId:patient().id}),onBusy:value=>{state.cameraBusy=value;lockWorkspace(value);renderWorkflow();},onRecorded:async(file,settings,context)=>{if(context.patientId!==patient().id||context.motion!==state.activeMotion||context.arm!==patient().arm)throw Error('촬영 당시 환자/동작과 다릅니다. 촬영 원본 저장 후 올바른 측정에 업로드하세요.');await loadVideoFile(file,settings);},toast:showToast});
window.addEventListener("resize", resizeOverlay);
window.addEventListener('pagehide',event=>{
  // A cached page can return with its original DOM/state. Revoking blob URLs
  // here previously destroyed its video connections on return.
  if(event.persisted)return;
  queue.cancelAll();engine.reset();revokeSessionUrls();
});
refreshSavedPatientList();
applyMotionImages();
updatePatientGate();
selectMotion("AB");
renderWorkflow();
try{
  const recovery=JSON.parse(window.sessionStorage.getItem(uploadRecoveryKey)||'null');
  if(recovery&&Date.now()-recovery.time<86400000&&MOTIONS.includes(recovery.motion)){
    setPatient(recovery.patient);updatePatientGate();selectMotion(recovery.motion);
    uploadFeedback(`이전 ${recovery.motion} ${recovery.stage} 작업이 완료되기 전에 화면이 다시 열렸습니다. 입력 정보만 복원했습니다. 저장된 결과는 환자 불러오기로 복원하고, 저장하지 않은 영상은 다시 선택하세요. iOS 앱 안에서 반복되면 Safari에서 이 주소를 직접 열고 ‘파일 선택’을 이용하세요.`);
  }
}catch{/* Invalid or unavailable session storage must not prevent startup. */}
export {state,session,selectMotion,openDetail,applyDetail,setView,patientPayload,validateImport,renderAll,queue};
