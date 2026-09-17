import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Output,
  WebMOutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedPacket,
  Input,
  BufferSource,
  WEBM,
  EncodedPacketSink,
} from '../dist/vendor/mediabunny-1.56.3.mjs';
import { processThrows } from '../dist/upload-processing.js';

test('real WebM muxer writes joined duration and timestamps regardless of processing delays', async () => {
  // Packet payload is only a VP8 header fixture: this checks container timing, not browser encoding.
  const bytes = new Uint8Array([16, 0, 0, 157, 1, 42, 16, 0, 16, 0, 0]);
  const target = new BufferTarget(),
    output = new Output({ format: new WebMOutputFormat(), target });
  const source = new EncodedVideoPacketSource('vp8');
  output.addVideoTrack(source);
  await output.start();
  class Video extends EventTarget {
    constructor() {
      super();
      this.duration = 26;
      this.readyState = 4;
      this.t = 0;
    }
    pause() {}
    get currentTime() {
      return this.t;
    }
    set currentTime(t) {
      this.t = t;
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    }
  }
  const expected = 0.3 + 0.31 + 0.32;
  const result = await processThrows({
    video: new Video(),
    windows: [
      { start_s: 3, end_s: 3.3 },
      { start_s: 11, end_s: 11.31 },
      { start_s: 20, end_s: 20.32 },
    ],
    reset() {},
    analyze: () => ({}),
    createWriter: async () => ({
      async add(t, d) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        await source.add(new EncodedPacket(bytes, 'key', t, d), {
          decoderConfig: { codec: 'vp8', codedWidth: 16, codedHeight: 16 },
        });
      },
      async finish() {
        await output.finalize();
        return new Blob([target.buffer], { type: 'video/webm' });
      },
      cancel: () => output.cancel(),
    }),
  });
  const input = new Input({
    source: new BufferSource(await result.blob.arrayBuffer()),
    formats: [WEBM],
  });
  try {
    assert.ok(Math.abs((await input.getDurationFromMetadata()) - expected) < 1 / 30);
    const track = await input.getPrimaryVideoTrack(),
      sink = new EncodedPacketSink(track);
    let packet = await sink.getFirstPacket(),
      i = 0;
    while (packet) {
      assert.ok(Math.abs(packet.timestamp - result.samples[i].t_s) <= 0.001);
      i++;
      packet = await sink.getNextPacket(packet);
    }
    assert.equal(i, result.samples.length);
    assert.equal(await input.getFirstTimestamp(), 0);
  } finally {
    input.dispose();
  }
});
