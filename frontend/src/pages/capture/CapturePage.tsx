import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import * as api from '../../api/client';
import { ProcessingService } from '../../services/processing';
import type { ThrowWindow, TrackingConfig } from '../../types/capture';
import { captureReducer, initialState } from './captureReducer';

const PRESETS: Record<string, { hue: number; swatch: string }> = {
  red: { hue: 0, swatch: '#ff5a62' },
  teal: { hue: 88, swatch: '#31c8c2' },
  yellow: { hue: 29, swatch: '#f6d65c' },
  purple: { hue: 143, swatch: '#b181f0' },
};

export default function CapturePage() {
  const [state, dispatch] = useReducer(captureReducer, initialState);
  const serviceRef = useRef<ProcessingService | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadJobRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const svc = new ProcessingService();
    serviceRef.current = svc;

    svc.subscribe(() => {
      const ps = svc.pipelineStatus;
      if (ps.ball) dispatch({ type: 'PIPELINE_LOADED', pipeline: 'ball' });
      if (ps.pose) dispatch({ type: 'PIPELINE_LOADED', pipeline: 'pose' });
      if (ps.hands) dispatch({ type: 'PIPELINE_LOADED', pipeline: 'hands' });
    });

    svc.initialize();

    return () => {
      svc.destroy();
      serviceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const svc = serviceRef.current;
    if (svc && videoRef.current && canvasRef.current) {
      svc.setElements(videoRef.current, canvasRef.current);
    }
  }, []);

  const frameStats = useSyncExternalStore(
    useCallback((cb: () => void) => serviceRef.current?.subscribe(cb) ?? (() => {}), []),
    useCallback(() => serviceRef.current?.frameStats ?? initialState as never, []),
  );

  const [config, setConfig] = useState({
    colour: 'red', hue: 0, tolerance: 14, saturation: 140, isolate: true,
  });
  const active =
    state.phase === 'recording' ||
    state.phase === 'scanning' ||
    state.phase === 'processing' ||
    state.phase === 'saving';

  const handleEnableCamera = async () => {
    const svc = serviceRef.current;
    if (!svc || state.opening || active) return;
    dispatch({ type: 'OPENING' });
    try {
      await svc.openCamera();
      dispatch({ type: 'CAMERA_OPENED' });
    } catch (e) {
      dispatch({ type: 'OPEN_FAILED', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleUpload = async (file: File) => {
    const svc = serviceRef.current;
    if (!svc || state.opening || active) return;
    dispatch({ type: 'OPENING' });
    try {
      await svc.loadVideo(file);
      dispatch({ type: 'VIDEO_UPLOADED' });
    } catch (e) {
      dispatch({ type: 'OPEN_FAILED', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleStartRecording = () => {
    const svc = serviceRef.current;
    if (!svc?.ready || active) return;
    if (state.source === 'upload') { handleFindThrows(); return; }
    svc.startRecording();
    dispatch({ type: 'RECORDING_STARTED' });
  };

  const handleStopRecording = async () => {
    const svc = serviceRef.current;
    if (!svc) return;
    if (uploadJobRef.current) {
      uploadJobRef.current.abort();
      uploadJobRef.current = null;
      dispatch({ type: 'CANCEL' });
      return;
    }
    const result = await svc.stopRecording();
    dispatch({ type: 'RECORDING_STOPPED' });
    if (!result) return;
    const report = svc.makeReport(result);
    await saveResult(report, result.processedBlob, result.rawBlob);
  };

  const handleFindThrows = async () => {
    const svc = serviceRef.current;
    if (!svc?.ready || active) return;
    const controller = new AbortController();
    uploadJobRef.current = controller;
    dispatch({ type: 'SCAN_STARTED' });
    try {
      const windows = await svc.scanThrows(controller.signal, (current, total) => {
        dispatch({ type: 'SCAN_PROGRESS', current, total });
      });
      dispatch({ type: 'SCAN_COMPLETE', windows });
    } catch (e) {
      if (!controller.signal.aborted) {
        dispatch({ type: 'SCAN_FAILED', message: e instanceof Error ? e.message : String(e) });
      } else {
        dispatch({ type: 'CANCEL' });
      }
    } finally {
      uploadJobRef.current = null;
    }
  };

  const handleProcessThrows = async () => {
    const svc = serviceRef.current;
    if (!svc?.ready || active) return;
    const controller = new AbortController();
    uploadJobRef.current = controller;
    dispatch({ type: 'PROCESS_STARTED' });
    try {
      const processed = await svc.processThrows(
        state.throwWindows, controller.signal,
        (done, total) => { dispatch({ type: 'PROCESS_PROGRESS', done, total }); },
      );
      dispatch({ type: 'PROCESS_COMPLETE' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svcUploadedFile = (svc as any).uploadedFile as File | null;
      const result = {
        processedBlob: processed.blob,
        rawBlob: svcUploadedFile ?? new Blob([]),
        samples: processed.samples,
        config: svc.currentConfig,
        cameraSettings: {},
        duration: processed.duration_s,
        origin: 0,
      };
      const report = svc.makeReport(result, processed.duration_s);
      if (svcUploadedFile) {
        Object.assign(report.capture, {
          original_filename: svcUploadedFile.name,
          original_duration_s: svc.videoDuration,
          analysis_fps: 30,
          requested_fps: 30,
          timestamp_source: 'source_video_seek',
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (report as any).throw_detection = {
        version: 'motion_windows_v1',
        is_heuristic: true,
        scan_fps: 15,
        reviewed: true,
        segments: processed.segments,
      };
      await saveResult(report, processed.blob, svcUploadedFile ?? new Blob([]));
    } catch (e) {
      if (!controller.signal.aborted) {
        dispatch({ type: 'PROCESS_FAILED', message: e instanceof Error ? e.message : String(e) });
      } else {
        dispatch({ type: 'CANCEL' });
      }
    } finally {
      uploadJobRef.current = null;
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saveResult = async (report: any, processedBlob: Blob, rawBlob: Blob) => {
    dispatch({ type: 'SAVE_PROGRESS', step: 'Creating record...' });
    try {
      const manifest = await api.saveResult(
        report,
        processedBlob.type || 'video/webm',
        rawBlob.size ? rawBlob.type || 'video/webm' : 'video/webm',
      );
      dispatch({ type: 'SAVE_PROGRESS', step: 'Uploading processed video...' });
      await api.uploadVideo(manifest.id, manifest.processed, processedBlob);
      dispatch({ type: 'SAVE_PROGRESS', step: 'Uploading original video...' });
      await api.uploadVideo(manifest.id, manifest.original, rawBlob);
      dispatch({ type: 'SAVE_PROGRESS', step: 'Completing...' });
      await api.completeResult(manifest.id);
      dispatch({ type: 'SAVE_COMPLETE', id: manifest.id });
    } catch (e) {
      dispatch({ type: 'SAVE_FAILED', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleColourPreset = (colour: string) => {
    const preset = PRESETS[colour];
    if (!preset) return;
    const updates = { colour, hue: preset.hue };
    setConfig((prev) => ({ ...prev, ...updates }));
    serviceRef.current?.setConfig(updates);
  };

  const handleConfigChange = (updates: Partial<TrackingConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
    serviceRef.current?.setConfig(updates);
  };

  const handleSampleColour = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const svc = serviceRef.current;
    if (!svc || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    svc.sampleColour((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
  };

  const handleWindowUpdate = (windows: ThrowWindow[]) => {
    dispatch({ type: 'UPDATE_WINDOWS', windows });
  };

  const isReady = state.pipelines.ball && state.pipelines.pose && state.pipelines.hands;
  const hasSource = state.source !== 'none';

  return (
    <main className="layout capture-layout">
      <section className="video-pane">
        <video ref={videoRef} id="source" playsInline hidden={state.phase !== 'reviewing'} controls={state.phase === 'reviewing'} />
        <canvas ref={canvasRef} id="output" hidden={state.phase === 'reviewing'} onClick={handleSampleColour} />

        {!hasSource && (
          <div id="empty">
            <h1>Chiron</h1>
            <p>Dodgeball throw analysis with body pose, hand tracking, and ball detection.</p>
            <div>
              <button onClick={handleEnableCamera} disabled={!isReady || state.opening}>
                Enable camera
              </button>
              <button onClick={() => fileInputRef.current?.click()} disabled={state.opening || active} style={{ marginLeft: 8 }}>
                Upload video
              </button>
            </div>
          </div>
        )}

        <div className="video-header">
          <span>{state.source === 'camera' ? 'LIVE CAMERA' : state.source === 'upload' ? 'UPLOADED VIDEO' : ''}</span>
          <a href="#/results">Results →</a>
        </div>

        <div className="video-controls">
          <div>
            {state.phase === 'scanning' && state.scanProgress && (
              <span>Finding throws · {state.scanProgress.current.toFixed(1)}s / {state.scanProgress.total.toFixed(1)}s</span>
            )}
            {state.phase === 'processing' && state.processProgress && (
              <span>Processing · {state.processProgress.done} / {state.processProgress.total} frames</span>
            )}
            {state.phase === 'saving' && <span>{state.saveStep}</span>}
            {state.phase === 'saved' && (
              <span>Saved! <a href={`#/results/${state.savedId}`}>View result →</a></span>
            )}
          </div>
          <div className="buttons">
            {hasSource && (
              <>
                <button onClick={handleStartRecording} disabled={!isReady || active || state.opening}>
                  {state.source === 'upload'
                    ? state.phase === 'reviewing' ? 'Find throws again' : 'Find throws'
                    : '● Start recording'}
                </button>
                <button onClick={handleStopRecording} disabled={state.phase !== 'recording' && !uploadJobRef.current}>
                  {uploadJobRef.current ? 'Cancel' : '■ Stop'}
                </button>
                {state.source === 'upload' && (
                  <button onClick={handleEnableCamera} disabled={active || state.opening}>Use camera</button>
                )}
              </>
            )}
            <button onClick={() => fileInputRef.current?.click()} disabled={active || state.opening} style={{ display: hasSource ? undefined : 'none' }}>
              Upload
            </button>
          </div>
          {state.errorMessage && (
            <p id="error">{state.errorMessage}</p>
          )}
          {!state.errorMessage && state.phase === 'loading' && (
            <p id="status">
              Loading pipelines... Ball: {state.pipelines.ball ? '✓' : '...'} Pose: {state.pipelines.pose ? '✓' : '...'} Hands: {state.pipelines.hands ? '✓' : '...'}
            </p>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,.mp4,.webm" style={{ display: 'none' }}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUpload(file); e.target.value = ''; }}
        />
      </section>

      <aside className="sidebar">
        <section className="half">
          <h2>Tracking</h2>
          <fieldset id="colours">
            <legend>Ball colour</legend>
            {Object.entries(PRESETS).map(([colour, preset]) => (
              <label key={colour} style={{ '--swatch': preset.swatch } as React.CSSProperties}>
                <input type="radio" name="colour" checked={config.colour === colour} onChange={() => handleColourPreset(colour)} />
                <span />
                {colour.charAt(0).toUpperCase() + colour.slice(1)}
              </label>
            ))}
          </fieldset>

          <div className="range-label"><span>Tolerance</span><span>{config.tolerance}</span></div>
          <input type="range" min="5" max="40" value={config.tolerance} onChange={(e) => handleConfigChange({ tolerance: parseInt(e.target.value) })} />

          <div className="range-label"><span>Saturation</span><span>{config.saturation}</span></div>
          <input type="range" min="30" max="255" value={config.saturation} onChange={(e) => handleConfigChange({ saturation: parseInt(e.target.value) })} />

          <label className="isolate-option">
            <input type="checkbox" checked={config.isolate} onChange={(e) => handleConfigChange({ isolate: e.target.checked })} />
            Show isolation overlay
          </label>

          <details>
            <summary>Sample from video</summary>
            <button onClick={() => { if (canvasRef.current) canvasRef.current.parentElement?.classList.toggle('sampling'); }} disabled={!hasSource || !isReady || active}>
              Click canvas to sample ball colour
            </button>
          </details>
        </section>

        <section className="half">
          <h2>Detection</h2>
          <div className="stats">
            <div><span>Ball</span><strong>{frameStats.ballState}</strong></div>
            <div><span>Body</span><strong>{frameStats.bodyState}</strong></div>
            <div><span>Hands</span><strong>{frameStats.handState}</strong></div>
            <div><span>Score</span><strong>{frameStats.trackingScore?.toFixed(2) ?? '—'}</strong></div>
            <div><span>FPS</span><strong>{frameStats.fps || '—'}</strong></div>
          </div>

          {state.phase === 'reviewing' && (
            <ThrowReview windows={state.throwWindows} onUpdate={handleWindowUpdate} onProcess={handleProcessThrows} videoRef={videoRef} disabled={active} />
          )}
        </section>
      </aside>
    </main>
  );
}

function ThrowReview({ windows, onUpdate, onProcess, videoRef, disabled }: {
  windows: ThrowWindow[];
  onUpdate: (windows: ThrowWindow[]) => void;
  onProcess: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  disabled: boolean;
}) {
  const handleAdd = () => {
    const v = videoRef.current;
    if (!v) return;
    const start = Math.max(0, Math.min(v.currentTime, v.duration - 1 / 30));
    onUpdate([...windows, { start_s: +start.toFixed(6), end_s: Math.min(v.duration, start + 2), edited: true, estimates: [] }]);
  };

  const handleRemove = (index: number) => { onUpdate(windows.filter((_, i) => i !== index)); };

  const handleChange = (index: number, field: 'start_s' | 'end_s', value: number) => {
    onUpdate(windows.map((w, i) => i === index ? { ...w, [field]: value, edited: true } : w));
  };

  const handlePreview = async (w: ThrowWindow) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = w.start_s;
    await v.play();
    const onTime = () => { if (v.currentTime >= w.end_s) { v.pause(); v.removeEventListener('timeupdate', onTime); } };
    v.addEventListener('timeupdate', onTime);
  };

  return (
    <div id="throw-review">
      <h2>Throw Windows</h2>
      <p className="hint">{windows.length ? 'Estimated boundaries. Review the full motion and adjust as needed.' : 'No throws found. Play the video, then add a window for each throw.'}</p>
      <div id="throw-windows">
        {windows.map((w, i) => (
          <fieldset key={i} className="throw-window">
            <legend>Throw {i + 1}{w.edited ? ' · edited' : w.estimates?.length ? ' · estimated' : ' · manual'}</legend>
            <label>Start (s)<input type="number" step="0.001" min="0" value={w.start_s} onChange={(e) => handleChange(i, 'start_s', parseFloat(e.target.value))} disabled={disabled} /></label>
            <label>End (s)<input type="number" step="0.001" min="0" value={w.end_s} onChange={(e) => handleChange(i, 'end_s', parseFloat(e.target.value))} disabled={disabled} /></label>
            <button type="button" onClick={() => handlePreview(w)} disabled={disabled}>Preview throw</button>
            <button type="button" onClick={() => handleRemove(i)} disabled={disabled}>Remove</button>
          </fieldset>
        ))}
      </div>
      <button type="button" onClick={handleAdd} disabled={disabled}>+ Add throw window</button>
      <button id="process-throws" className="primary" onClick={onProcess} disabled={disabled || windows.length === 0}>
        Process {windows.length} throw{windows.length !== 1 ? 's' : ''}
      </button>
    </div>
  );
}
