export const POSE_LANDMARKS = [
  { id: "left_shoulder", index: 11, label: "왼쪽 어깨" },
  { id: "right_shoulder", index: 12, label: "오른쪽 어깨" },
  { id: "left_elbow", index: 13, label: "왼쪽 팔꿈치" },
  { id: "right_elbow", index: 14, label: "오른쪽 팔꿈치" },
  { id: "left_wrist", index: 15, label: "왼쪽 손목" },
  { id: "right_wrist", index: 16, label: "오른쪽 손목" },
  { id: "left_hip", index: 23, label: "왼쪽 골반" },
  { id: "right_hip", index: 24, label: "오른쪽 골반" }
];

export const HAND_LANDMARKS = [
  { id: "left_hand_tip", label: "왼쪽 손끝" },
  { id: "right_hand_tip", label: "오른쪽 손끝" }
];

export const LANDMARKS = [...POSE_LANDMARKS, ...HAND_LANDMARKS];

export const CONNECTIONS = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"]
];

export const MOTION_LABELS = {
  AB: "외전",
  FE: "굴곡",
  ER: "신전",
  BIR: "기능적 내회전",
  IRER: "외회전",
  CIR: "회전 궤적"
};

export const MOTION_DEFINITIONS = {
  AB: { code: "AB", name: "외전", view: "정면", guide: "팔을 옆으로 가능한 만큼 올리기", measure: "어깨–팔꿈치 각도" },
  FE: { code: "FE", name: "굴곡", view: "측면", guide: "팔을 앞으로 들어 올리기", measure: "어깨–팔꿈치 각도" },
  ER: { code: "ER", name: "신전", view: "측면", guide: "팔을 뒤로 보내기", measure: "어깨–팔꿈치 각도" },
  BIR: { code: "BIR", name: "기능적 내회전", view: "후면", guide: "손등을 등 뒤로 올리기", measure: "척추 도달 높이" },
  IRER: { code: "IRER", name: "외회전", view: "정면", guide: "팔꿈치 몸통 옆 · 90° 굽혀 바깥으로 회전", measure: "3D 외회전각 (추정)" },
  CIR: { code: "CIR", name: "회전 궤적", view: "측면", guide: "팔꿈치 90° 후 원 그리기", measure: "궤적·흔들림" }
};

export function clonePoints(points) {
  return Object.fromEntries(Object.entries(points).map(([key, value]) => [key, { ...value }]));
}

export function buildFrameTargets(duration, sourceFps, frameStep = 1) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const safeFps = Math.max(1, Math.min(120, Number(sourceFps) || 30));
  const safeStep = Math.max(1, Math.min(30, Math.round(Number(frameStep) || 1)));
  const totalFrames = Math.max(1, Math.floor(Math.max(0, safeDuration - 0.0001) * safeFps) + 1);
  const targets = [];
  for (let sourceFrame = 0; sourceFrame < totalFrames; sourceFrame += safeStep) {
    targets.push({
      sourceFrame,
      time: Number(Math.min(sourceFrame / safeFps, Math.max(0, safeDuration - 0.001)).toFixed(6))
    });
  }
  return targets;
}

export function nextMonotonicTimestamp(previous = 0, now = 0) {
  return Math.max(Number(now) || 0, (Number(previous) || 0) + 1);
}

export function angleAt(a, vertex, c) {
  if (!a || !vertex || !c) return null;
  if ([a, vertex, c].some(p => p.status !== "manual" && p.visibility != null && p.visibility < 0.45)) return null;
  const aspect = vertex.aspectRatio || 1;
  const v1 = { x: (a.x - vertex.x) * aspect, y: a.y - vertex.y };
  const v2 = { x: (c.x - vertex.x) * aspect, y: c.y - vertex.y };
  const length = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!length) return null;
  const cosine = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / length));
  return Math.acos(cosine) * (180 / Math.PI);
}

export function shoulderAngles(points) {
  return {
    left: angleAt(points.left_elbow, points.left_shoulder, points.left_hip),
    right: angleAt(points.right_elbow, points.right_shoulder, points.right_hip)
  };
}

export function elbowAngles(points) {
  return {
    left: angleAt(points.left_shoulder, points.left_elbow, points.left_wrist),
    right: angleAt(points.right_shoulder, points.right_elbow, points.right_wrist)
  };
}

export function isEdited(raw, corrected, epsilon = 0.0005) {
  return Math.abs(raw.x - corrected.x) > epsilon || Math.abs(raw.y - corrected.y) > epsilon;
}

export function editedPointIds(frame) {
  return LANDMARKS.filter(({ id }) => isEdited(frame.raw[id], frame.corrected[id])).map(({ id }) => id);
}

export function qualityOf(points) {
  const values = Object.entries(points)
    .filter(([id]) => !id.endsWith("_hand_tip"))
    .map(([, point]) => Number(point.visibility ?? 0));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function templatePoints(phase = 0) {
  const lift = Math.sin(phase) * 0.16;
  return {
    left_shoulder: { x: 0.42, y: 0.34, z: 0, visibility: 0 },
    right_shoulder: { x: 0.58, y: 0.34, z: 0, visibility: 0 },
    left_elbow: { x: 0.31, y: 0.46 - lift, z: 0, visibility: 0 },
    right_elbow: { x: 0.69, y: 0.46 - lift, z: 0, visibility: 0 },
    left_wrist: { x: 0.24, y: 0.61 - lift * 1.25, z: 0, visibility: 0 },
    right_wrist: { x: 0.76, y: 0.61 - lift * 1.25, z: 0, visibility: 0 },
    left_hip: { x: 0.45, y: 0.70, z: 0, visibility: 0 },
    right_hip: { x: 0.55, y: 0.70, z: 0, visibility: 0 },
    left_hand_tip: { x: 0.22, y: 0.60 - lift * 1.3, z: 0, visibility: 0 },
    right_hand_tip: { x: 0.78, y: 0.60 - lift * 1.3, z: 0, visibility: 0 }
  };
}

export function frameRecord({ index, time, motion, phase = "미분류", points, source = "AI" }) {
  const raw = clonePoints(points);
  return {
    index,
    time: Number(time.toFixed(4)),
    motion,
    phase,
    source,
    raw,
    corrected: clonePoints(raw),
    quality: Number(qualityOf(raw).toFixed(4))
  };
}

export function summarize(frames) {
  const angles = frames.flatMap(frame => {
    const result = shoulderAngles(frame.corrected);
    return [result.left, result.right].filter(Number.isFinite);
  });
  const editedFrames = frames.filter(frame => editedPointIds(frame).length > 0);
  const editedPoints = editedFrames.reduce((sum, frame) => sum + editedPointIds(frame).length, 0);
  const quality = frames.length ? frames.reduce((sum, frame) => sum + frame.quality, 0) / frames.length : null;
  return {
    frameCount: frames.length,
    duration: frames.length ? frames.at(-1).time : 0,
    maxAngle: angles.length ? Math.max(...angles) : null,
    editedFrames: editedFrames.length,
    editedPoints,
    quality
  };
}

export function resolveRepresentativeFrame(automatic, manual, frameCount = Infinity) {
  const valid = value => Number.isInteger(value) && value >= 0 && value < frameCount;
  const autoRepresentativeFrame = valid(automatic) ? automatic : null;
  const manualRepresentativeFrame = valid(manual) ? manual : null;
  return {
    autoRepresentativeFrame,
    manualRepresentativeFrame,
    finalRepresentativeFrame: manualRepresentativeFrame ?? autoRepresentativeFrame,
    representativeSelectionType: manualRepresentativeFrame == null ? "auto" : "manual"
  };
}
