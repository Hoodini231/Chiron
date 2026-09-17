import { buildTimeline, detectThrowWindows, SCAN_FPS } from './throw-windows.js';

export function checkCancelled(signal) {
  if (signal?.aborted)
    throw new DOMException('Processing cancelled. Your throw windows are kept.', 'AbortError');
}

export async function seekVideo(video, time, signal) {
  checkCancelled(signal);
  video.pause();
  if (Math.abs(video.currentTime - time) < 1e-7 && video.readyState >= 2 && !video.seeking) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      signal?.removeEventListener('abort', abort);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('Could not read a video frame. Try again or choose another video.'));
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Processing cancelled. Your throw windows are kept.', 'AbortError'));
    };
    const timer = setTimeout(fail, 15000);
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      video.currentTime = time;
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
  checkCancelled(signal);
}

const yieldUI = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function scanThrows({ video, analyze, reset, signal, progress }) {
  reset();
  const samples = [],
    duration = video.duration;
  for (let i = 0; i / SCAN_FPS < duration; i++) {
    const t = i / SCAN_FPS;
    await seekVideo(video, t, signal);
    const sample = analyze(t, false);
    samples.push({ ...sample, t_s: t });
    progress?.(t, duration);
    await yieldUI();
    checkCancelled(signal);
  }
  return detectThrowWindows(samples, duration, video.videoWidth, video.videoHeight);
}

export async function processThrows({
  video,
  windows,
  analyze,
  reset,
  createWriter,
  signal,
  progress,
}) {
  const timeline = buildTimeline(windows, video.duration),
    samples = [];
  checkCancelled(signal);
  const writer = await createWriter();
  try {
    let previous = null;
    for (const frame of timeline.frames) {
      checkCancelled(signal);
      if (frame.throw_id !== previous) {
        reset();
        previous = frame.throw_id;
      }
      await seekVideo(video, frame.source_media_time_s, signal);
      const sample = analyze(frame.source_media_time_s, true, frame);
      samples.push({ ...sample, ...frame });
      await writer.add(frame.t_s, frame.duration_s);
      progress?.(samples.length, timeline.frames.length);
      await yieldUI();
      checkCancelled(signal);
    }
    const blob = await writer.finish();
    checkCancelled(signal);
    return { blob, samples, ...timeline };
  } catch (e) {
    await writer.cancel();
    throw e;
  }
}
