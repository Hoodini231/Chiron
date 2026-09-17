let    media;
const loadMedia=()=>media    ??=    import(   './vendor/mediabunny-1.56.3.mjs'   );
const unsupported = () =>
  new Error(
    'This browser cannot export trimmed video. Open the local app in a current Chrome or Edge browser.',
  );

export async function checkEncoderSupport(width = 640, height = 360) {
  if (typeof globalThis.VideoEncoder === 'undefined') throw unsupported();
  const { canEncodeVideo } = await loadMedia();
  for (const codec of ['vp9', 'vp8']) {
    if (await canEncodeVideo(codec, { width, height, bitrate: 8000000 })) return codec;
  }
  throw unsupported();
}

export async function createVideoWriter(canvas) {
  const codec = await checkEncoderSupport(canvas.width, canvas.height);
  const { Output, WebMOutputFormat, BufferTarget, CanvasSource } = await loadMedia();
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, { codec, bitrate: 8000000, keyFrameInterval: 1 });
  output.addVideoTrack(source);
  try {
    await output.start();
  } catch (e) {
    await output.cancel();
    throw e;
  }
  return {
    add: (timestamp, duration) => source.add(timestamp, duration),
    async finish() {
      await output.finalize();
      const blob = new Blob([target.buffer], { type: 'video/webm' });
      if (blob.size > 160 * 1024 * 1024)
        throw new Error('The processed video exceeds 160 MB. Shorten the throw windows and retry.');
      return blob;
    },
    async cancel() {
      if (output.state !== 'finalized') await output.cancel();
    },
  };
}
