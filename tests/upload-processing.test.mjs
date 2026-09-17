import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanThrows, processThrows, seekVideo } from '../dist/upload-processing.js';
import { checkEncoderSupport } from '../dist/video-writer.js';
import { throwSample } from './throw-fixtures.mjs';

export class FakeVideo extends EventTarget {
  constructor(duration = 26) {
    super();
    this.duration = duration;
    this.time = 0;
    this.readyState = 4;
    this.videoWidth = 640;
    this.videoHeight = 640;
    this.seeking = false;
  }
  pause() {}
  get currentTime() {
    return this.time;
  }
  set currentTime(t) {
    this.time = t;
    this.seeking = true;
    queueMicrotask(() => {
      this.seeking = false;
      this.dispatchEvent(new Event('seeked'));
    });
  }
}
test('scan skips hand analysis, final processing only visits approved windows and resets per throw', async () => {
  const video = new FakeVideo(),
    calls = [],
    encoded = [];
  let resets = 0,
    finished = 0;
  const windows = await scanThrows({
    video,
    reset: () => resets++,
    analyze: (t, detailed) => {
      calls.push(detailed);
      return throwSample(t);
    },
  });
  assert.equal(windows.length, 3);
  assert.equal(calls.length, 390);
  assert.ok(calls.every((v) => v === false));
  calls.length = 0;
  resets = 0;
  const result = await processThrows({
    video,
    windows,
    reset: () => resets++,
    analyze: (t, detailed) => {
      assert.equal(detailed, true);
      calls.push(t);
      return throwSample(t);
    },
    createWriter: async () => ({
      add: async (t, d) => {
        encoded.push([t, d]);
      },
      finish: async () => {
        finished++;
        return new Blob(['webm']);
      },
      cancel: async () => assert.fail('unexpected cancellation'),
    }),
  });
  assert.equal(resets, 3);
  assert.equal(finished, 1);
  assert.equal(calls.length, result.samples.length);
  assert.equal(encoded.length, result.samples.length);
  assert.ok(calls.every((t) => windows.some((w) => t >= w.start_s && t < w.end_s)));
  assert.deepEqual(
    encoded,
    result.samples.map((s) => [s.t_s, s.duration_s]),
  );
});
test('seek to zero/current frame does not wait for a nonexistent seek event', async () => {
  const video = new FakeVideo();
  await seekVideo(video, 0);
  await seekVideo(video, 2);
  await seekVideo(video, 2);
  assert.equal(video.currentTime, 2);
});
test('cancelling processing releases writer and preserves editable windows for retry', async () => {
  const video = new FakeVideo(),
    windows = [{ start_s: 1, end_s: 1.2, edited: true }],
    snapshot = JSON.stringify(windows),
    controller = new AbortController();
  let cancelled = 0,
    finished = 0;
  const options = {
    video,
    windows,
    reset() {},
    analyze: (t) => throwSample(t),
    createWriter: async () => ({
      add: async () => controller.abort(),
      finish: async () => finished++,
      cancel: async () => cancelled++,
    }),
    signal: controller.signal,
  };
  await assert.rejects(processThrows(options), { name: 'AbortError' });
  assert.equal(cancelled, 1);
  assert.equal(finished, 0);
  assert.equal(JSON.stringify(windows), snapshot);
  const retry = await processThrows({
    ...options,
    signal: new AbortController().signal,
    createWriter: async () => ({
      add: async () => {},
      finish: async () => new Blob(['ok']),
      cancel: async () => {},
    }),
  });
  assert.equal(retry.samples.length, 6);
});
test('encoder failures discard partial output and absent encoding support gives actionable message', async () => {
  let cancelled = false;
  await assert.rejects(
    processThrows({
      video: new FakeVideo(),
      windows: [{ start_s: 0, end_s: 0.1 }],
      reset() {},
      analyze: () => ({}),
      createWriter: async () => ({
        add: async () => {
          throw Error('encoder failed');
        },
        cancel: async () => {
          cancelled = true;
        },
      }),
    }),
    /encoder failed/,
  );
  assert.ok(cancelled);
  await assert.rejects(checkEncoderSupport(), /Chrome or Edge/);
});
