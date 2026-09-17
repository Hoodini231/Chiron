import type { ThrowEstimate } from './schema';

export type CapturePhase =
  | 'loading'
  | 'idle'
  | 'recording'
  | 'scanning'
  | 'reviewing'
  | 'processing'
  | 'saving'
  | 'saved'
  | 'error';

export interface TrackingConfig {
  colour: string;
  hue: number;
  tolerance: number;
  saturation: number;
  isolate: boolean;
}

export interface ThrowWindow {
  start_s: number;
  end_s: number;
  edited: boolean;
  estimates: ThrowEstimate[];
}

export interface PipelineStatus {
  ball: boolean;
  pose: boolean;
  hands: boolean;
}

export interface FrameStats {
  ballState: string;
  bodyState: string;
  handState: string;
  trackingScore: number | null;
  trackingPhase: string | null;
  fps: number;
}
