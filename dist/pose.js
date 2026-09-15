import {FilesetResolver, PoseLandmarker} from './vendor/vision_bundle.mjs';
export const LANDMARK_NAMES = ['nose','left_eye_inner','left_eye','left_eye_outer','right_eye_inner','right_eye','right_eye_outer','left_ear','right_ear','mouth_left','mouth_right','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_pinky','right_pinky','left_index','right_index','left_thumb','right_thumb','left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle','left_heel','right_heel','left_foot_index','right_foot_index'];
const EDGES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
export async function createPoseTracker() {
  const files = await FilesetResolver.forVisionTasks('./vendor/wasm');
  return PoseLandmarker.createFromOptions(files, {baseOptions:{modelAssetPath:'./vendor/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5,outputSegmentationMasks:false});
}
export function drawPose(ctx, landmarks, width, height) {
  if (!landmarks) return;
  const visible = p => p && (p.visibility ?? 0) >= .5 && (p.presence ?? 1) >= .5;
  ctx.strokeStyle='#66c9ff'; ctx.fillStyle='#b1e4ff'; ctx.lineWidth=Math.max(2,width/500);
  for (const [a,b] of EDGES) if(visible(landmarks[a]) && visible(landmarks[b])) {
    ctx.beginPath(); ctx.moveTo(landmarks[a].x*width,landmarks[a].y*height); ctx.lineTo(landmarks[b].x*width,landmarks[b].y*height); ctx.stroke();
  }
  landmarks.forEach((p,i)=>{if(i>=11&&visible(p)){ctx.beginPath();ctx.arc(p.x*width,p.y*height,Math.max(3,width/320),0,2*Math.PI);ctx.fill();}});
}
