/**
 * ProcessingService wraps the existing vanilla JS CV/ML modules behind
 * an operations API. All mutable state (tracker instances, canvases,
 * MediaRecorder, sample arrays) lives here, NOT in React state.
 *
 * React subscribes to throttled snapshots via subscribe/getSnapshot.
 */

import type { FrameStats, PipelineStatus, TrackingConfig } from '../types/capture';
import type { Sample } from '../types/schema';

type Listener = () => void;

export interface RecordingResult {
  processedBlob: Blob;
  rawBlob: Blob;
  samples: Sample[];
  config: TrackingConfig;
  cameraSettings: Record<string, unknown>;
  duration: number;
  origin: number;
}

export interface ProcessedResult {
  blob: Blob;
  samples: Sample[];
  segments: unknown[];
  duration_s: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = any;

export class ProcessingService {
  private initialized = false;
  private destroyed = false;

  // Pipeline instances
  private tracker: AnyModule = null;
  private poseTracker: AnyModule = null;
  private handTracker: AnyModule = null;

  // Module references
  private modules: {
    BallTracker?: AnyModule;
    PRESETS?: AnyModule;
    createPoseTracker?: AnyModule;
    drawPose?: AnyModule;
    createHandTracker?: AnyModule;
    collectHands?: AnyModule;
    drawHands?: AnyModule;
    handFeatures?: AnyModule;
    poseFeatures?: AnyModule;
    summarize?: AnyModule;
    validateWindows?: AnyModule;
    scanThrows?: AnyModule;
    processThrows?: AnyModule;
    seekVideo?: AnyModule;
    checkEncoderSupport?: AnyModule;
    createVideoWriter?: AnyModule;
  } = {};

  // Canvases
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private small: HTMLCanvasElement = document.createElement('canvas');
  private sctx: CanvasRenderingContext2D | null = null;
  private rawFrame: HTMLCanvasElement = document.createElement('canvas');
  private rawContext: CanvasRenderingContext2D | null = null;
  private isolatedFrame: HTMLCanvasElement = document.createElement('canvas');

  // Video element
  private video: HTMLVideoElement | null = null;

  // State
  private stream: MediaStream | null = null;
  private uploadedFile: File | null = null;
  private uploadURL: string | null = null;
  private frameHandle: number | null = null;
  private mlTimestamp = 0;
  private recording: AnyModule = null;
  private trail: AnyModule[] = [];
  latestTime = 0;
  private lastFrame = -1;
  private lastWall = 0;
  private fps = 0;
  private config: TrackingConfig = {
    colour: 'red',
    hue: 0,
    tolerance: 14,
    saturation: 140,
    isolate: true,
  };

  // Observable state for React
  private _pipelineStatus: PipelineStatus = {
    ball: false,
    pose: false,
    hands: false,
  };
  private _frameStats: FrameStats = {
    ballState: 'Loading',
    bodyState: 'Loading',
    handState: 'Loading',
    trackingScore: null,
    trackingPhase: null,
    fps: 0,
  };
  private _ready = false;
  private listeners = new Set<Listener>();
  private lastNotify = 0;

  get ready() {
    return this._ready;
  }

  get pipelineStatus() {
    return this._pipelineStatus;
  }

  get frameStats() {
    return this._frameStats;
  }

  get currentConfig() {
    return this.config;
  }

  get hasStream() {
    return !!this.stream;
  }

  get hasUpload() {
    return !!this.uploadedFile;
  }

  get isRecording() {
    return !!this.recording;
  }

  get videoElement() {
    return this.video;
  }

  get videoDuration() {
    return this.video?.duration ?? 0;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot() {
    return this._frameStats;
  }

  private notify() {
    const now = performance.now();
    if (now - this.lastNotify < 100) return;
    this.lastNotify = now;
    for (const listener of this.listeners) listener();
  }

  async initialize() {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;

    this.sctx = this.small.getContext('2d', { willReadFrequently: true });
    this.rawContext = this.rawFrame.getContext('2d');

    await Promise.all([this.loadTracker(), this.loadPose(), this.loadHands(), this.loadModules()]);
  }

  private async loadModules() {
    const [features, handFeat, throwWin, uploadProc, videoWriter] = await Promise.all([
      import('@pipelines/features.js' /* @vite-ignore */),
      import('@pipelines/hand-features.js' /* @vite-ignore */),
      import('@pipelines/throw-windows.js' /* @vite-ignore */),
      import('@pipelines/upload-processing.js' /* @vite-ignore */),
      import('@pipelines/video-writer.js' /* @vite-ignore */),
    ]);
    this.modules.poseFeatures = features.poseFeatures;
    this.modules.summarize = features.summarize;
    this.modules.handFeatures = handFeat.handFeatures;
    this.modules.validateWindows = throwWin.validateWindows;
    this.modules.scanThrows = uploadProc.scanThrows;
    this.modules.processThrows = uploadProc.processThrows;
    this.modules.seekVideo = uploadProc.seekVideo;
    this.modules.checkEncoderSupport = videoWriter.checkEncoderSupport;
    this.modules.createVideoWriter = videoWriter.createVideoWriter;
  }

  private async loadTracker() {
    try {
      const { cv } = await new Promise<{ cv: AnyModule }>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Tracker download timed out. Reload to retry.')),
          90000,
        );
        const script = document.createElement('script');
        script.src = '/vendor/opencv.js';
        script.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Could not load the ball tracker. Reload to retry.'));
        };
        script.onload = () => {
          const loaded = (window as AnyModule).cv;
          const finish = (runtime: AnyModule) => {
            clearTimeout(timeout);
            resolve({ cv: runtime });
          };
          try {
            if (loaded?.Mat) finish(loaded);
            else if (loaded?.then) loaded.then(finish);
            else if (loaded) loaded.onRuntimeInitialized = () => finish(loaded);
          } catch (e) {
            clearTimeout(timeout);
            reject(e);
          }
        };
        document.head.append(script);
      });

      const trackerMod = await import('@pipelines/tracker.js' /* @vite-ignore */);
      this.modules.BallTracker = trackerMod.BallTracker;
      this.modules.PRESETS = trackerMod.PRESETS;
      this.tracker = new trackerMod.BallTracker(cv);

      this._pipelineStatus = { ...this._pipelineStatus, ball: true };
      this._ready =
        this._pipelineStatus.ball && this._pipelineStatus.pose && this._pipelineStatus.hands;
      this._frameStats = { ...this._frameStats, ballState: 'Ready' };
      this.notify();
    } catch {
      this._frameStats = { ...this._frameStats, ballState: 'Unavailable' };
      this.notify();
    }
  }

  private async loadPose() {
    try {
      const poseMod = await import('@pipelines/pose.js' /* @vite-ignore */);
      this.modules.createPoseTracker = poseMod.createPoseTracker;
      this.modules.drawPose = poseMod.drawPose;
      this.poseTracker = await poseMod.createPoseTracker();

      this._pipelineStatus = { ...this._pipelineStatus, pose: true };
      this._ready =
        this._pipelineStatus.ball && this._pipelineStatus.pose && this._pipelineStatus.hands;
      this._frameStats = { ...this._frameStats, bodyState: 'Ready' };
      this.notify();
    } catch {
      this._frameStats = { ...this._frameStats, bodyState: 'Unavailable' };
      this.notify();
    }
  }

  private async loadHands() {
    try {
      const handsMod = await import('@pipelines/hands.js' /* @vite-ignore */);
      this.modules.createHandTracker = handsMod.createHandTracker;
      this.modules.collectHands = handsMod.collectHands;
      this.modules.drawHands = handsMod.drawHands;
      this.handTracker = await handsMod.createHandTracker();

      this._pipelineStatus = { ...this._pipelineStatus, hands: true };
      this._ready =
        this._pipelineStatus.ball && this._pipelineStatus.pose && this._pipelineStatus.hands;
      this._frameStats = { ...this._frameStats, handState: 'Ready' };
      this.notify();
    } catch {
      this._frameStats = { ...this._frameStats, handState: 'Unavailable' };
      this.notify();
    }
  }

  setElements(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  setConfig(updates: Partial<TrackingConfig>) {
    this.config = { ...this.config, ...updates };
  }

  sampleColour(canvasX: number, canvasY: number): TrackingConfig | null {
    if (!this.sctx || !this.small.width) return null;
    const scaleX = this.small.width / (this.canvas?.width ?? 1);
    const scaleY = this.small.height / (this.canvas?.height ?? 1);
    const sx = Math.round(canvasX * scaleX);
    const sy = Math.round(canvasY * scaleY);
    const pixel = this.sctx.getImageData(sx, sy, 1, 1).data;
    const [r, g, b] = pixel;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 30);
    }
    this.config = { ...this.config, colour: 'sampled', hue: h };
    if (this.tracker) {
      this.tracker.seed(sx, sy);
    }
    this.notify();
    return this.config;
  }

  async openCamera(): Promise<void> {
    if (this.stream || this.destroyed) return;
    this.clearSource();

    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera access needs HTTPS or localhost.');

    const candidate = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
        facingMode: 'environment',
      },
    });

    if (!this.video || !this.canvas) {
      candidate.getTracks().forEach((t) => t.stop());
      throw new Error('Video/canvas elements not set');
    }

    this.video.srcObject = candidate;
    try {
      await this.video.play();
    } catch (e) {
      candidate.getTracks().forEach((t) => t.stop());
      throw e;
    }

    this.stream = candidate;
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.rawFrame.width = this.canvas.width;
    this.rawFrame.height = this.canvas.height;
    this.small.width = Math.min(640, this.canvas.width);
    this.small.height = Math.round((this.canvas.height * this.small.width) / this.canvas.width);

    this.lastFrame = -1;
    this.scheduleFrame();
    this.notify();
  }

  async loadVideo(file: File): Promise<void> {
    if (this.destroyed) return;
    if (file.size > 160 * 1024 * 1024) throw new Error('Choose a video smaller than 160 MB.');

    const type =
      file.type ||
      (/\.mp4$/i.test(file.name) ? 'video/mp4' : /\.webm$/i.test(file.name) ? 'video/webm' : '');
    if (!['video/mp4', 'video/webm'].includes(type))
      throw new Error('Choose an MP4 or WebM video.');

    this.clearSource();

    if (!this.video || !this.canvas) throw new Error('Elements not set');

    this.uploadURL = URL.createObjectURL(file);
    this.video.autoplay = false;

    await new Promise<void>((resolve, reject) => {
      const v = this.video!;
      const timer = setTimeout(() => reject(new Error('Video decode timed out.')), 15000);
      const cleanup = () => {
        clearTimeout(timer);
        v.removeEventListener('loadeddata', done);
        v.removeEventListener('error', fail);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error('Could not decode video. Try MP4 or WebM.'));
      };
      v.addEventListener('loadeddata', done);
      v.addEventListener('error', fail);
      v.src = this.uploadURL!;
      v.load();
    });

    if (
      !Number.isFinite(this.video.duration) ||
      this.video.duration <= 0 ||
      this.video.duration > 120
    )
      throw new Error('Choose a video up to 2 minutes long.');

    this.uploadedFile = type === file.type ? file : new File([file], file.name, { type });
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.rawFrame.width = this.canvas.width;
    this.rawFrame.height = this.canvas.height;
    this.small.width = Math.min(640, this.canvas.width);
    this.small.height = Math.round((this.canvas.height * this.small.width) / this.canvas.width);

    this.processFrame(performance.now(), {
      mediaTime: this.video.currentTime,
    });
    this.notify();
  }

  closeCamera() {
    this.clearSource();
    this.notify();
  }

  private clearSource() {
    if (this.frameHandle !== null) {
      this.video?.cancelVideoFrameCallback?.(this.frameHandle);
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      if (this.uploadURL) URL.revokeObjectURL(this.uploadURL);
      this.uploadURL = null;
      this.uploadedFile = null;
      this.video.removeAttribute('src');
    }
    this.tracker?.reset();
    this.trail = [];
    this.lastFrame = -1;
  }

  private scheduleFrame() {
    if (!this.stream || !this.video) return;
    if (this.video.requestVideoFrameCallback) {
      this.frameHandle = this.video.requestVideoFrameCallback(
        (now: number, metadata: { mediaTime: number }) => this.onFrame(now, metadata),
      );
    } else {
      this.frameHandle = requestAnimationFrame((now) =>
        this.onFrame(now, { mediaTime: this.video!.currentTime }),
      );
    }
  }

  private onFrame(now: number, metadata: { mediaTime: number }) {
    this.frameHandle = null;
    if (!(this.stream || this.uploadedFile)) return;
    this.processFrame(now, metadata);
    if (this.stream) this.scheduleFrame();
  }

  processFrame(
    now: number,
    metadata: { mediaTime: number },
    options: {
      offline?: boolean;
      detailed?: boolean;
      outputFrame?: { throw_id: number; t_s: number } | null;
    } = {},
  ): Sample | null {
    const { offline = false, detailed = true, outputFrame = null } = options;
    if (!this.video || !this.canvas || !this.ctx) return null;
    if (this.video.readyState < 2) return null;

    const t = metadata.mediaTime;
    if (!offline && this.lastFrame === t) return null;
    this.lastFrame = t;
    this.latestTime = t;

    const dt = (now - this.lastWall) / 1000;
    this.lastWall = now;
    if (dt > 0 && dt < 1) this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;

    this.rawContext!.drawImage(this.video, 0, 0, this.rawFrame.width, this.rawFrame.height);
    this.ctx.drawImage(this.rawFrame, 0, 0, this.canvas.width, this.canvas.height);
    this.sctx!.drawImage(this.rawFrame, 0, 0, this.small.width, this.small.height);

    let ball: AnyModule = null;
    let pose: AnyModule = null;
    let hands: AnyModule[] = [];

    if (this._ready) {
      try {
        this.mlTimestamp = offline
          ? this.mlTimestamp + (detailed ? 1000 / 30 : 1000 / 15)
          : Math.max(this.mlTimestamp + 0.001, now);

        pose = this.poseTracker.detectForVideo(this.small, this.mlTimestamp).landmarks[0] ?? null;

        hands = detailed
          ? this.modules.handFeatures!(
              this.modules.collectHands!(
                this.handTracker.detectForVideo(this.rawFrame, this.mlTimestamp),
              ),
              pose,
              this.canvas.width,
              this.canvas.height,
            )
          : [];

        ball = this.tracker.detect(this.small, t, this.config, {
          hands,
          pose,
          isolationCanvas: this.config.isolate ? this.isolatedFrame : null,
        });

        if (this.config.isolate)
          this.ctx.drawImage(this.isolatedFrame, 0, 0, this.canvas.width, this.canvas.height);
      } catch (e) {
        if (offline)
          throw new Error(
            'A tracking pipeline failed. Your throw windows are kept; retry processing.',
          );
        this._ready = false;
      }
    }

    // Draw overlays
    this.modules.drawPose?.(this.ctx, pose, this.canvas.width, this.canvas.height);
    this.modules.drawHands?.(this.ctx, hands, this.canvas.width, this.canvas.height);

    // Ball trail
    if (ball) {
      const scale = this.canvas.width / this.small.width;
      ball = {
        ...ball,
        x: ball.x * scale,
        y: ball.y * scale,
        radius: ball.radius * scale,
      };
      if (
        this.trail.length &&
        (t - this.trail[this.trail.length - 1].t > 0.12 ||
          this.trail[this.trail.length - 1].track_id !== ball.track_id)
      )
        this.trail = [];
      this.trail.push({ ...ball, t });
    }
    this.trail = this.trail.filter((p) => t - p.t < 0.8);

    this.ctx.strokeStyle = '#c5f36b';
    this.ctx.lineWidth = Math.max(2, this.canvas.width / 400);
    this.ctx.beginPath();
    this.trail.forEach((p, i) => (i ? this.ctx!.lineTo(p.x, p.y) : this.ctx!.moveTo(p.x, p.y)));
    this.ctx.stroke();

    if (ball) {
      this.ctx.beginPath();
      this.ctx.arc(ball.x, ball.y, ball.radius + 5, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.fillStyle = '#c5f36b';
      this.ctx.beginPath();
      this.ctx.arc(ball.x, ball.y, 3, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Prediction circle
    const ballStatus = this.tracker?.status;
    const prediction = ballStatus?.prediction;
    if (prediction && this._ready) {
      const scale = this.canvas.width / this.small.width;
      this.ctx.save();
      this.ctx.strokeStyle = '#d9a65c';
      this.ctx.setLineDash([6, 6]);
      this.ctx.beginPath();
      this.ctx.arc(
        prediction.x * scale,
        prediction.y * scale,
        prediction.radius * scale + 5,
        0,
        Math.PI * 2,
      );
      this.ctx.stroke();
      this.ctx.restore();
    }

    // Output frame HUD
    if (outputFrame) {
      this.ctx.fillStyle = '#101319cf';
      this.ctx.fillRect(12, 12, 360, 42);
      this.ctx.fillStyle = '#c5f36b';
      this.ctx.font = '18px monospace';
      this.ctx.fillText(`THROW ${outputFrame.throw_id} · ${outputFrame.t_s.toFixed(2)}s`, 24, 39);
    }

    // Recording HUD
    if (this.recording) {
      const r = this.recording;
      if (r.origin === null) r.origin = t;
      const elapsed = t - r.origin;
      const size = Math.max(16, Math.round(this.canvas.width / 55));
      this.ctx.fillStyle = '#101319cf';
      this.ctx.fillRect(12, 12, size * 24, size * 2.1);
      this.ctx.font = `${size}px monospace`;
      this.ctx.fillStyle = '#c5f36b';
      this.ctx.fillText(
        `REC ${Math.floor(elapsed / 60)
          .toString()
          .padStart(
            2,
            '0',
          )}:${(elapsed % 60).toFixed(1).padStart(4, '0')} · ${ball ? 'BALL DETECTED' : 'BALL NOT VISIBLE'}`,
        24,
        12 + size * 1.4,
      );
      r.processedStream.getVideoTracks()[0].requestFrame?.();
    }

    // Build sample
    const detectorScale = this.canvas.width / this.small.width;
    const sample: Sample = {
      frame_index: null,
      t_s: t,
      source_media_time_s: t,
      ball: ball
        ? {
            x_px: +ball.x.toFixed(2),
            y_px: +ball.y.toFixed(2),
            radius_px: +ball.radius.toFixed(2),
            tracking_score: +ball.score.toFixed(3),
            observed: true,
            track_id: ball.track_id,
            tracking_phase: ball.tracking_phase,
            hand_distance_px:
              ball.hand_distance_px === null
                ? null
                : +(ball.hand_distance_px * detectorScale).toFixed(2),
            hand_source: ball.hand_source,
            hand_side: ball.hand_side,
            motion_blur_candidate: ball.blurred,
            colour_mask_source: ball.mask_source,
          }
        : null,
      ball_tracking: {
        state: ballStatus?.state ?? 'searching',
        phase: ballStatus?.phase ?? 'searching',
        track_id: ballStatus?.track_id ?? 0,
      },
      ball_prediction: prediction
        ? {
            x_px: prediction.x * detectorScale,
            y_px: prediction.y * detectorScale,
            radius_px: prediction.radius * detectorScale,
          }
        : null,
      pose:
        pose?.map((p: AnyModule) => ({
          x: p.x,
          y: p.y,
          z: p.z,
          visibility: p.visibility,
          presence: p.presence,
        })) ?? null,
      features_2d: this.modules.poseFeatures?.(pose, this.canvas.width, this.canvas.height) ?? null,
      hands,
    };

    if (this.recording) {
      const r = this.recording;
      const elapsed = t - r.origin;
      r.samples.push({
        ...sample,
        frame_index: r.samples.length,
        t_s: +elapsed.toFixed(6),
      });
    }

    // Update observable stats (throttled)
    const phaseLabels: Record<string, string> = {
      near_hand: 'Near hand',
      flight: 'In flight',
      unassociated: 'Detected',
    };
    this._frameStats = {
      ballState: ball
        ? phaseLabels[ball.tracking_phase] || 'Detected'
        : this._ready
          ? prediction
            ? 'Predicted briefly'
            : 'Not visible'
          : 'Waiting',
      bodyState: pose
        ? 'Detected'
        : this._ready
          ? 'Not visible'
          : this.poseTracker
            ? 'Ready'
            : 'Loading',
      handState: hands.length
        ? `${hands.length} detected`
        : this._ready
          ? 'Not visible'
          : this.handTracker
            ? 'Ready'
            : 'Loading',
      trackingScore: ball ? ball.score : null,
      trackingPhase: ball ? ball.tracking_phase : null,
      fps: this.fps ? Math.round(this.fps) : 0,
    };
    this.notify();

    return sample;
  }

  // Recording
  startRecording(): void {
    if (!this._ready || !(this.stream || this.uploadedFile) || !this.canvas) return;

    const processedStream = this.canvas.captureStream(0);
    const processedChunks: Blob[] = [];
    const rawChunks: Blob[] = [];

    const mimeType = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/mp4',
      'video/webm',
    ].find((t) => MediaRecorder.isTypeSupported(t));

    const opts = {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 8000000,
    };

    const processedRecorder = new MediaRecorder(processedStream, opts);
    processedRecorder.ondataavailable = (e) => {
      if (e.data.size) processedChunks.push(e.data);
    };

    let rawRecorder: MediaRecorder | null = null;
    if (this.stream) {
      rawRecorder = new MediaRecorder(this.stream, opts);
      rawRecorder.ondataavailable = (e) => {
        if (e.data.size) rawChunks.push(e.data);
      };
    }

    this.recording = {
      processedRecorder,
      rawRecorder,
      processedChunks,
      rawChunks,
      processedStream,
      samples: [],
      origin: null,
      startWall: performance.now(),
      config: { ...this.config },
      cameraSettings: this.stream ? this.stream.getVideoTracks()[0].getSettings() : {},
    };

    processedRecorder.start(1000);
    rawRecorder?.start(1000);
  }

  async stopRecording(): Promise<RecordingResult | null> {
    if (!this.recording) return null;
    const r = this.recording;
    this.recording = null;

    const processedDone = new Promise<void>((resolve) => {
      r.processedRecorder.onstop = resolve;
    });
    const rawDone = r.rawRecorder
      ? new Promise<void>((resolve) => {
          r.rawRecorder.onstop = resolve;
        })
      : Promise.resolve();

    r.processedRecorder.stop();
    r.rawRecorder?.stop();

    await Promise.all([processedDone, rawDone]);

    const processedBlob = new Blob(r.processedChunks, {
      type: r.processedRecorder.mimeType,
    });
    const rawBlob = r.rawRecorder
      ? new Blob(r.rawChunks, { type: r.rawRecorder.mimeType })
      : new Blob([]);

    return {
      processedBlob,
      rawBlob,
      samples: r.samples,
      config: r.config,
      cameraSettings: r.cameraSettings,
      duration: r.samples.length ? r.samples[r.samples.length - 1].t_s : 0,
      origin: r.origin ?? 0,
    };
  }

  // Upload scanning/processing
  private resetUploadTracking() {
    this.tracker?.reset();
    this.trail = [];
    this.lastFrame = -1;
    this.mlTimestamp += 1000;
  }

  private uploadAnalysis(
    t: number,
    detailed: boolean,
    outputFrame: { throw_id: number; t_s: number } | null,
  ) {
    return this.processFrame(
      performance.now(),
      { mediaTime: t },
      {
        offline: true,
        detailed,
        outputFrame,
      },
    );
  }

  async scanThrows(signal: AbortSignal, onProgress: (current: number, total: number) => void) {
    if (!this.video || !this._ready || !this.modules.scanThrows) return [];

    await this.modules.checkEncoderSupport?.(this.canvas!.width, this.canvas!.height);

    return this.modules.scanThrows({
      video: this.video,
      analyze: (t: number, detailed: boolean, outputFrame: AnyModule) =>
        this.uploadAnalysis(t, detailed, outputFrame),
      reset: () => this.resetUploadTracking(),
      signal,
      progress: onProgress,
    });
  }

  async processThrows(
    windows: unknown[],
    signal: AbortSignal,
    onProgress: (done: number, total: number) => void,
  ): Promise<ProcessedResult> {
    if (!this.video || !this._ready || !this.modules.processThrows) throw new Error('Not ready');

    return this.modules.processThrows({
      video: this.video,
      windows,
      analyze: (t: number, detailed: boolean, outputFrame: AnyModule) =>
        this.uploadAnalysis(t, detailed, outputFrame),
      reset: () => this.resetUploadTracking(),
      signal,
      createWriter: () => this.modules.createVideoWriter!(this.canvas!),
      progress: onProgress,
    });
  }

  makeReport(recordingResult: RecordingResult, durationOverride?: number) {
    const duration = durationOverride ?? recordingResult.duration;
    const samples = recordingResult.samples;
    const config = recordingResult.config;

    return {
      schema_version: '0.2',
      created_at: new Date().toISOString(),
      measurement_mode: 'single_camera_uncalibrated',
      coordinate_system: {
        origin: 'top_left',
        x: 'right',
        y: 'down',
        unit: 'pixel',
        width: this.canvas?.width ?? 0,
        height: this.canvas?.height ?? 0,
      },
      capture: {
        requested_fps: 60,
        reported_camera_fps: recordingResult.cameraSettings?.frameRate ?? null,
        processed_frames: samples.length,
        duration_s: +duration.toFixed(6),
        timestamp_source: 'requestVideoFrameCallback.mediaTime',
        recording_frame_alignment:
          't_s=0 is first processed frame after record start; recorder startup offset is not calibrated',
        source: this.uploadedFile ? 'uploaded_video' : 'camera',
        processed_segment_s: [0, +duration.toFixed(6)],
      },
      tracking: {
        method: 'opencv_colour_segmentation_and_validated_circle_edges',
        colour: config.colour,
        hue: config.hue,
        tolerance: config.tolerance,
        saturation: config.saturation,
        isolate: config.isolate,
        score_is_probability: false,
        detection_fraction: 0,
        association: 'hand_acquisition_ball_motion_v2',
        prediction_horizon_s: 0.2,
        identity_timeout_s: 0.5,
        phase_is_heuristic: true,
      },
      body_pipeline: {
        model: 'mediapipe_pose_landmarker_full',
        version: '0.10.21',
      },
      hands_pipeline: {
        model: 'mediapipe_hand_landmarker',
        version: '0.10.21',
      },
      limitations: [
        'No metric calibration — all positions are in image pixels',
        'Joint angles are projected 2D, not true anatomical angles',
        'Ball detection is colour-based and can lose the ball',
        'Throw events are not implemented',
        'Video records browser processing cadence, not high-speed camera acquisition',
        'Original and processed recorder start times may differ slightly',
      ],
      samples,
      metrics: this.modules.summarize?.({ samples }) ?? {},
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearSource();
    this.listeners.clear();
  }
}
