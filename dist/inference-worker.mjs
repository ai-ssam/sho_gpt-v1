let pose,hand,handCrop,fileset,vision,timestamp=0,lowMemory=false,cropCanvas;
let activeDelegate='CPU';
async function createModel(kind,options){
 try{const model=await vision[kind].createFromOptions(fileset,{...options,baseOptions:{...options.baseOptions,delegate:'GPU'}});activeDelegate='GPU';return model;}catch{activeDelegate='CPU';return vision[kind].createFromOptions(fileset,options);}
}
async function initialize(withHands,mobile){
  lowMemory=!!mobile;
  if(!vision){self.exports={};importScripts('./vendor/vision.js');vision=self.exports;}
  fileset??=await vision.FilesetResolver.forVisionTasks(new URL('./vendor/wasm',self.location.href).href);
  if(!pose)pose=await createModel('PoseLandmarker',{baseOptions:{modelAssetPath:new URL('./vendor/pose_landmarker_lite.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45});
  if(withHands&&!hand)hand=await createModel('HandLandmarker',{baseOptions:{modelAssetPath:new URL('./vendor/hand_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:lowMemory?'IMAGE':'VIDEO',numHands:2,minHandDetectionConfidence:.4,minHandPresenceConfidence:.4,minTrackingConfidence:.4});
  if(withHands&&!handCrop)handCrop=lowMemory?hand:await createModel('HandLandmarker',{baseOptions:{modelAssetPath:new URL('./vendor/hand_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:'IMAGE',numHands:1,minHandDetectionConfidence:.4,minHandPresenceConfidence:.4});
}
function refineMeasuredHand(bitmap,poses,hands,arm) {
  const body=poses.landmarks?.[0];if(!body||!handCrop)return hands;
  const wrist=body[arm==='left'?15:16],elbow=body[arm==='left'?13:14];
  if((wrist.visibility??0)<.45)return hands;
  if(hands?.landmarks?.some(points=>Math.hypot(points[0].x-wrist.x,points[0].y-wrist.y)<.12))return hands;
  const w=bitmap.width,h=bitmap.height,forearm=Math.hypot((wrist.x-elbow.x)*w,(wrist.y-elbow.y)*h);
  const size=Math.min(w,h,Math.max(128,Math.min(512,forearm*1.8)));
  const left=Math.max(0,Math.min(w-size,(wrist.x+(wrist.x-elbow.x)*.2)*w-size/2));
  const top=Math.max(0,Math.min(h-size,(wrist.y+(wrist.y-elbow.y)*.2)*h-size/2));
  const canvas=cropCanvas??=new OffscreenCanvas(256,256);canvas.getContext('2d').drawImage(bitmap,left,top,size,size,0,0,256,256);
  const refined=handCrop.detect(canvas);
  const mapped=refined.landmarks.map(points=>points.map(p=>({...p,x:(left+p.x*size)/w,y:(top+p.y*size)/h,z:p.z*size/w})));
  return {landmarks:[...(hands?.landmarks??[]),...mapped],handedness:[...(hands?.handedness??[]),...refined.handedness]};
}
self.onmessage=async({data})=>{
  const {id,type,bitmap,withHands,arm}=data;
  try{
    if(type==='init'){await initialize(withHands,data.lowMemory);self.postMessage({id,ok:true,delegate:activeDelegate});return;}
    timestamp=Math.max(timestamp+1,performance.now());
    const poses=pose.detectForVideo(bitmap,timestamp);
    let hands=withHands&&hand?(lowMemory?hand.detect(bitmap):hand.detectForVideo(bitmap,timestamp)):null;
    if(withHands)hands=refineMeasuredHand(bitmap,poses,hands,arm);
    self.postMessage({id,poses:poses.landmarks,world:poses.worldLandmarks,delegate:activeDelegate,hands:hands?{landmarks:hands.landmarks,handedness:hands.handedness}:null});
  }catch(error){self.postMessage({id,error:error.message||String(error)});}
  finally{bitmap?.close();}
};
