import type { CapturePhase, PipelineStatus, ThrowWindow } from '../../types/capture';

export interface CaptureState {
  phase: CapturePhase;
  pipelines: PipelineStatus;
  source: 'none' | 'camera' | 'upload';
  elapsed: number;
  scanProgress: { current: number; total: number } | null;
  processProgress: { done: number; total: number } | null;
  saveStep: string | null;
  savedId: string | null;
  throwWindows: ThrowWindow[];
  errorMessage: string | null;
  opening: boolean;
}

export type CaptureAction =
  | { type: 'PIPELINE_LOADED'; pipeline: 'ball' | 'pose' | 'hands' }
  | { type: 'OPENING' }
  | { type: 'CAMERA_OPENED' }
  | { type: 'VIDEO_UPLOADED' }
  | { type: 'OPEN_FAILED'; message: string }
  | { type: 'RECORDING_STARTED' }
  | { type: 'RECORDING_STOPPED' }
  | { type: 'ELAPSED'; seconds: number }
  | { type: 'SCAN_STARTED' }
  | { type: 'SCAN_PROGRESS'; current: number; total: number }
  | { type: 'SCAN_COMPLETE'; windows: ThrowWindow[] }
  | { type: 'SCAN_FAILED'; message: string }
  | { type: 'UPDATE_WINDOWS'; windows: ThrowWindow[] }
  | { type: 'PROCESS_STARTED' }
  | { type: 'PROCESS_PROGRESS'; done: number; total: number }
  | { type: 'PROCESS_COMPLETE' }
  | { type: 'PROCESS_FAILED'; message: string }
  | { type: 'SAVE_PROGRESS'; step: string }
  | { type: 'SAVE_COMPLETE'; id: string }
  | { type: 'SAVE_FAILED'; message: string }
  | { type: 'CANCEL' }
  | { type: 'RESET' }
  | { type: 'ERROR'; message: string }
  | { type: 'CLEAR_ERROR' };

export const initialState: CaptureState = {
  phase: 'loading',
  pipelines: { ball: false, pose: false, hands: false },
  source: 'none',
  elapsed: 0,
  scanProgress: null,
  processProgress: null,
  saveStep: null,
  savedId: null,
  throwWindows: [],
  errorMessage: null,
  opening: false,
};

export function captureReducer(
  state: CaptureState,
  action: CaptureAction,
): CaptureState {
  switch (action.type) {
    case 'PIPELINE_LOADED': {
      const pipelines = { ...state.pipelines, [action.pipeline]: true };
      const allReady = pipelines.ball && pipelines.pose && pipelines.hands;
      return {
        ...state,
        pipelines,
        phase: allReady ? 'idle' : 'loading',
      };
    }

    case 'OPENING':
      return { ...state, opening: true, errorMessage: null };

    case 'CAMERA_OPENED':
      return { ...state, opening: false, source: 'camera', phase: 'idle' };

    case 'VIDEO_UPLOADED':
      return { ...state, opening: false, source: 'upload', phase: 'idle' };

    case 'OPEN_FAILED':
      return { ...state, opening: false, errorMessage: action.message };

    case 'RECORDING_STARTED':
      return { ...state, phase: 'recording', elapsed: 0, errorMessage: null };

    case 'ELAPSED':
      return { ...state, elapsed: action.seconds };

    case 'RECORDING_STOPPED':
      return { ...state, phase: 'idle' };

    case 'SCAN_STARTED':
      return {
        ...state,
        phase: 'scanning',
        scanProgress: { current: 0, total: 0 },
        errorMessage: null,
      };

    case 'SCAN_PROGRESS':
      return {
        ...state,
        scanProgress: { current: action.current, total: action.total },
      };

    case 'SCAN_COMPLETE':
      return {
        ...state,
        phase: 'reviewing',
        throwWindows: action.windows,
        scanProgress: null,
      };

    case 'SCAN_FAILED':
      return {
        ...state,
        phase: 'reviewing',
        scanProgress: null,
        errorMessage: action.message,
      };

    case 'UPDATE_WINDOWS':
      return { ...state, throwWindows: action.windows };

    case 'PROCESS_STARTED':
      return {
        ...state,
        phase: 'processing',
        processProgress: { done: 0, total: 0 },
        errorMessage: null,
      };

    case 'PROCESS_PROGRESS':
      return {
        ...state,
        processProgress: { done: action.done, total: action.total },
      };

    case 'PROCESS_COMPLETE':
      return { ...state, processProgress: null };

    case 'PROCESS_FAILED':
      return {
        ...state,
        phase: 'reviewing',
        processProgress: null,
        errorMessage: action.message,
      };

    case 'SAVE_PROGRESS':
      return { ...state, phase: 'saving', saveStep: action.step };

    case 'SAVE_COMPLETE':
      return {
        ...state,
        phase: 'saved',
        savedId: action.id,
        saveStep: null,
      };

    case 'SAVE_FAILED':
      return {
        ...state,
        phase: 'error',
        saveStep: null,
        errorMessage: action.message,
      };

    case 'CANCEL':
      return {
        ...state,
        phase: state.source === 'upload' ? 'reviewing' : 'idle',
        scanProgress: null,
        processProgress: null,
      };

    case 'RESET':
      return {
        ...initialState,
        pipelines: state.pipelines,
        phase: state.pipelines.ball && state.pipelines.pose && state.pipelines.hands
          ? 'idle'
          : 'loading',
      };

    case 'ERROR':
      return { ...state, errorMessage: action.message };

    case 'CLEAR_ERROR':
      return { ...state, errorMessage: null };

    default:
      return state;
  }
}
