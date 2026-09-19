export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence?: number;
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface HandFeatures2D {
  index_pip_deg: number | null;
  middle_pip_deg: number | null;
  ring_pip_deg: number | null;
  pinky_pip_deg: number | null;
  projected_wrist_bend_deg: number | null;
}

export interface HandDetection {
  landmarks: HandLandmark[];
  handedness_model: string;
  handedness_score: number;
  associated_pose_side: string | null;
  pose_wrist_distance_px: number | null;
  features_2d: HandFeatures2D | null;
}

export interface BallDetection {
  x_px: number;
  y_px: number;
  radius_px: number;
  tracking_score: number;
  observed: boolean;
  track_id: number;
  tracking_phase: 'searching' | 'near_hand' | 'flight' | 'unassociated';
  hand_distance_px: number | null;
  hand_source: string | null;
  hand_side: string | null;
  motion_blur_candidate: boolean;
  colour_mask_source: string;
}

export interface BallTracking {
  state: 'observed' | 'predicted' | 'lost';
  phase: string;
  phase_is_heuristic?: boolean;
  track_id: number;
}

export interface BallPrediction {
  x_px: number;
  y_px: number;
  radius_px: number;
}

export interface Features2D {
  left_elbow_deg: number | null;
  right_elbow_deg: number | null;
  left_knee_deg: number | null;
  right_knee_deg: number | null;
  shoulder_line_deg?: number | null;
  hip_line_deg?: number | null;
  hip_shoulder_separation_deg?: number | null;
}

export interface Sample {
  frame_index: number | null;
  t_s: number;
  source_media_time_s: number;
  presented_frame?: number | null;
  throw_id?: number;
  duration_s?: number;
  ball: BallDetection | null;
  ball_tracking: BallTracking | null;
  ball_prediction: BallPrediction | null;
  pose: PoseLandmark[] | null;
  features_2d: Features2D | null;
  hands: HandDetection[];
}

export interface AngleRange {
  min: number;
  max: number;
  observations: number;
}

export interface WristBendSamples {
  left: { observations: number };
  right: { observations: number };
}

export interface RotationVelocity {
  peak: number | null;
  mean: number | null;
  observations: number;
}

export interface Metrics {
  duration_s: number;
  processed_frames: number;
  processed_fps: number | null;
  throw_count?: number;
  original_duration_s?: number;
  ball_detection_fraction: number;
  pose_detection_fraction: number;
  hand_detection_fraction: number;
  wrist_bend_samples: WristBendSamples;
  projected_angles_deg: Record<string, AngleRange>;
  shoulder_rotation_velocity_deg_s?: RotationVelocity;
  hip_rotation_velocity_deg_s?: RotationVelocity;
  ball_speed_m_s: number | null;
  time_to_load_s: number | null;
  time_to_release_s: number | null;
  ball_spin_rpm: number | null;
}

export interface CoordinateSystem {
  origin: string;
  x: string;
  y: string;
  unit: string;
  width: number;
  height: number;
}

export interface CaptureInfo {
  requested_fps: number;
  reported_camera_fps: number | null;
  processed_frames: number;
  duration_s: number;
  timestamp_source: string;
  recording_frame_alignment?: string;
  source: 'camera' | 'uploaded_video';
  original_filename?: string;
  original_duration_s?: number;
  processed_segment_s?: [number, number];
  analysis_fps?: number;
}

export interface TrackingInfo {
  method: string;
  colour: string;
  hue: number;
  tolerance: number;
  saturation: number;
  isolate: boolean;
  score_is_probability: boolean;
  detection_fraction: number;
  association: string;
  prediction_horizon_s: number;
  identity_timeout_s: number;
  phase_is_heuristic: boolean;
}

export interface ThrowEstimate {
  source_start_s: number;
  source_end_s: number;
  source_peak_s: number;
  output_peak_s: number;
  side: string;
  confidence: string;
}

export interface ThrowSegment {
  id: number;
  source_start_s: number;
  source_end_s: number;
  output_start_s: number;
  output_end_s: number;
  source_start_analysis_frame?: number;
  source_end_analysis_frame_exclusive?: number;
  edited: boolean;
  estimates: ThrowEstimate[];
}

export interface ThrowDetection {
  version: string;
  is_heuristic: boolean;
  scan_fps: number;
  reviewed: boolean;
  segments: ThrowSegment[];
}

export interface PipelineInfo {
  model: string;
  version: string;
  landmark_names?: string[];
}

export interface Report {
  schema_version: string;
  created_at: string;
  measurement_mode: string;
  coordinate_system: CoordinateSystem;
  capture: CaptureInfo;
  tracking: TrackingInfo;
  body_pipeline: PipelineInfo;
  hands_pipeline: PipelineInfo;
  throw_detection?: ThrowDetection;
  limitations: string[];
  samples: Sample[];
  metrics: Metrics;
}

export interface Manifest {
  id: string;
  created_at: string;
  processed: string;
  original: string;
  metrics: Metrics;
}
