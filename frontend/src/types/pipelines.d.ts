declare module '*/pipelines/tracker.js' {
  export const BallTracker: any;
  export const PRESETS: any;
}

declare module '*/pipelines/pose.js' {
  export const createPoseTracker: any;
  export const drawPose: any;
  export const LANDMARK_NAMES: string[];
}

declare module '*/pipelines/hands.js' {
  export const createHandTracker: any;
  export const collectHands: any;
  export const drawHands: any;
  export const HAND_NAMES: string[];
}

declare module '*/pipelines/hand-features.js' {
  export const handFeatures: any;
}

declare module '*/pipelines/features.js' {
  export const poseFeatures: any;
  export const summarize: any;
}

declare module '*/pipelines/throw-windows.js' {
  export const detectThrowWindows: any;
  export const buildTimeline: any;
  export const validateWindows: any;
  export const SCAN_FPS: number;
}

declare module '*/pipelines/upload-processing.js' {
  export const scanThrows: any;
  export const processThrows: any;
  export const seekVideo: any;
}

declare module '*/pipelines/video-writer.js' {
  export const checkEncoderSupport: any;
  export const createVideoWriter: any;
}

declare module '/vendor/vision_bundle.mjs' {
  export const FilesetResolver: any;
  export const PoseLandmarker: any;
  export const HandLandmarker: any;
}

declare module '/vendor/mediabunny-1.56.3.mjs' {
  export const canEncodeVideo: any;
  export const Output: any;
  export const WebMOutputFormat: any;
  export const BufferTarget: any;
  export const CanvasSource: any;
}
