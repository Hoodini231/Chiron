import { FilesetResolver, HandLandmarker } from './vendor/vision_bundle.mjs';
export const HAND_NAMES = [
  'wrist',
  'thumb_cmc',
  'thumb_mcp',
  'thumb_ip',
  'thumb_tip',
  'index_mcp',
  'index_pip',
  'index_dip',
  'index_tip',
  'middle_mcp',
  'middle_pip',
  'middle_dip',
  'middle_tip',
  'ring_mcp',
  'ring_pip',
  'ring_dip',
  'ring_tip',
  'pinky_mcp',
  'pinky_pip',
  'pinky_dip',
  'pinky_tip',
];
const EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
export async function createHandTracker() {
  const files = await FilesetResolver.forVisionTasks('./vendor/wasm');
  return HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: './vendor/hand_landmarker_full.task', delegate: 'CPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
}
export function collectHands(result) {
  return result.landmarks.map((landmarks, i) => ({
    landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    handedness_model: result.handedness[i]?.[0]?.categoryName ?? null,
    handedness_score: result.handedness[i]?.[0]?.score ?? null,
  }));
}
export function drawHands(ctx, hands, width, height) {
  ctx.strokeStyle = '#ffbd70';
  ctx.fillStyle = '#ffe1bd';
  ctx.lineWidth = Math.max(1.5, width / 640);
  for (const hand of hands) {
    const p = hand.landmarks;
    for (const [a, b] of EDGES) {
      ctx.beginPath();
      ctx.moveTo(p[a].x * width, p[a].y * height);
      ctx.lineTo(p[b].x * width, p[b].y * height);
      ctx.stroke();
    }
    for (const l of p) {
      ctx.beginPath();
      ctx.arc(l.x * width, l.y * height, Math.max(2, width / 600), 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}
