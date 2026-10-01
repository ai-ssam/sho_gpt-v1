"""Independent offline MediaPipe smoke test. Not a browser or clinical validation.
Usage: python tests/sample-inference.py SAMPLE_DIR OUTPUT_JSON
Requires mediapipe==0.10.21 and opencv-python-headless==4.11.0.86.
Output contains patient coordinates: keep outside the public dist directory.
"""
import cv2, mediapipe as mp, json, sys, pathlib, math
root=pathlib.Path(__file__).resolve().parents[1]
source=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2])
landmarks={'left_shoulder':11,'right_shoulder':12,'left_elbow':13,'right_elbow':14,'left_wrist':15,'right_wrist':16,'left_hip':23,'right_hip':24}
results={}
for path in sorted(source.iterdir()):
    if path.suffix.lower() not in ['.mov','.mp4']:continue
    code=next(c for c in ['BIR','CIR','AB','FE','ER'] if '_'+c+'_' in path.name.upper())
    pose=mp.tasks.vision.PoseLandmarker.create_from_options(mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(root/'dist/vendor/pose_landmarker_lite.task')),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=1,min_pose_detection_confidence=.45,min_pose_presence_confidence=.45,min_tracking_confidence=.45))
    hand=None;crop_hand=None
    if True:
        hand=mp.tasks.vision.HandLandmarker.create_from_options(mp.tasks.vision.HandLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(root/'dist/vendor/hand_landmarker.task')),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_hands=2,min_hand_detection_confidence=.4,min_hand_presence_confidence=.4,min_tracking_confidence=.4))
        crop_hand=mp.tasks.vision.HandLandmarker.create_from_options(mp.tasks.vision.HandLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(root/'dist/vendor/hand_landmarker.task')),running_mode=mp.tasks.vision.RunningMode.IMAGE,num_hands=1,min_hand_detection_confidence=.4,min_hand_presence_confidence=.4))
    cap=cv2.VideoCapture(str(path));fps=cap.get(cv2.CAP_PROP_FPS);rows=[];pose_count=0;thumb_count=0
    while True:
        ok,bgr=cap.read()
        if not ok:break
        i=len(rows);height,width=bgr.shape[:2];image=mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB));timestamp=round(i/fps*1000)
        detected=pose.detect_for_video(image,timestamp);points={name:{'x':0.,'y':0.,'z':0.,'visibility':0.,'status':'missing','aspectRatio':width/height} for name in landmarks}
        if detected.pose_landmarks:
            pose_count+=1
            for name,n in landmarks.items():
                p=detected.pose_landmarks[0][n];points[name]={'x':p.x,'y':p.y,'z':p.z,'visibility':p.visibility,'status':'detected' if p.visibility>=.45 else 'missing','aspectRatio':width/height}
        for side in ['left','right']:points[side+'_hand_tip']={**points[side+'_wrist'],'visibility':0.,'status':'missing'}
        if hand and detected.pose_landmarks:
            found=hand.detect_for_video(image,timestamp)
            wrist=points['left_wrist'];elbow=points['left_elbow']
            if wrist['visibility']>=.45 and not any(math.hypot(p[0].x-wrist['x'],p[0].y-wrist['y'])<.12 for p in found.hand_landmarks):
                forearm=math.hypot((wrist['x']-elbow['x'])*width,(wrist['y']-elbow['y'])*height);size=min(width,height,max(128,min(512,forearm*1.8)))
                left=max(0,min(width-size,(wrist['x']+(wrist['x']-elbow['x'])*.2)*width-size/2));top=max(0,min(height-size,(wrist['y']+(wrist['y']-elbow['y'])*.2)*height-size/2))
                crop=cv2.resize(bgr[int(top):int(top+size),int(left):int(left+size)],(256,256));refined=crop_hand.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(crop,cv2.COLOR_BGR2RGB)))
                for group in refined.hand_landmarks:
                    for p in group:p.x=(left+p.x*size)/width;p.y=(top+p.y*size)/height;p.z=p.z*size/width
                found.hand_landmarks.extend(refined.hand_landmarks);found.handedness.extend(refined.handedness)
            unused=set(range(len(found.hand_landmarks)))
            for side in ['left','right']:
                wrist=points[side+'_wrist']
                if wrist['visibility']<.45 or not unused:continue
                index=min(unused,key=lambda j:math.hypot(found.hand_landmarks[j][0].x-wrist['x'],found.hand_landmarks[j][0].y-wrist['y']))
                p=found.hand_landmarks[index][0]
                if math.hypot(p.x-wrist['x'],p.y-wrist['y'])>.15:continue
                unused.remove(index);tip=found.hand_landmarks[index][4];confidence=found.handedness[index][0].score
                points[side+'_hand_tip']={'x':tip.x,'y':tip.y,'z':tip.z,'visibility':confidence,'status':'detected' if confidence>=.45 else 'missing','aspectRatio':width/height}
        thumb_count+=points['left_hand_tip']['visibility']>=.45
        rows.append({'index':i,'sourceFrame':i,'sourceFps':fps,'time':i/fps,'motion':code,'phase':'미분류','source':'offline-python-validation','raw':points,'corrected':points,'quality':sum(p['visibility'] for k,p in points.items() if k in landmarks)/8})
    cap.release();pose.close()
    if hand:hand.close()
    if crop_hand:crop_hand.close()
    results[code]={'file':path.name,'frames':rows,'poseDetected':pose_count,'thumbDetected':thumb_count}
    print(json.dumps({'motion':code,'frames':len(rows),'poseDetected':pose_count,'thumbDetected':thumb_count},ensure_ascii=False),flush=True)
output.write_text(json.dumps(results,ensure_ascii=False),encoding='utf-8')
