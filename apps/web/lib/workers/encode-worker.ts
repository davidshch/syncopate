import {
  Application,
  Signal,
  createEncoder,
} from "libopus-wasm";
import {
  OPUS_BITRATE,
  OPUS_COMPLEXITY,
  OPUS_FRAME_SAMPLES,
  RING_WRITE,
  SAMPLE_RATE,
  attachPcmRing,
  encodeAudioPacket,
  ringAvailable,
  ringCaptureFrame,
  ringRead,
} from "@syncopate/shared";

let running = false;
let encoder: Awaited<ReturnType<typeof createEncoder>> | null = null;
let ring: ReturnType<typeof attachPcmRing> | null = null;
let seq = 0;
let offsetUs = 0;
let audioOriginPerfUs = 0;
const frame = new Float32Array(OPUS_FRAME_SAMPLES);

self.onmessage = (event: MessageEvent) => {
  const data = event.data as
    | { type: "init"; sab: SharedArrayBuffer; capacity: number }
    | { type: "clock"; offsetUs: number; audioOriginPerfUs: number }
    | { type: "stop" };

  if (data.type === "init") {
    ring = attachPcmRing(data.sab, data.capacity);
    void start();
    return;
  }
  if (data.type === "clock") {
    offsetUs = data.offsetUs;
    audioOriginPerfUs = data.audioOriginPerfUs;
    return;
  }
  if (data.type === "stop") {
    running = false;
    encoder?.free();
    encoder = null;
  }
};

async function start(): Promise<void> {
  try {
    encoder = await createEncoder({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      application: Application.RestrictedLowDelay,
      bitrate: OPUS_BITRATE,
      complexity: OPUS_COMPLEXITY,
      signal: Signal.Music,
      vbr: false,
      fec: true,
      dtx: false,
      frameSize: OPUS_FRAME_SAMPLES,
      packetLossPercent: 5,
    });
    running = true;
    void loop();
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "opus encoder failed",
    });
  }
}

async function loop(): Promise<void> {
  while (running && encoder && ring) {
    while (ringAvailable(ring) >= OPUS_FRAME_SAMPLES) {
      const captureFrame = ringCaptureFrame(ring);
      ringRead(ring, frame);
      try {
        const opus = encoder.encodeFloat(frame);
        const capturePerfUs =
          audioOriginPerfUs + (captureFrame / SAMPLE_RATE) * 1e6;
        const buffer = encodeAudioPacket({
          flags: 0,
          seq,
          captureFrame,
          serverUs: capturePerfUs + offsetUs,
          pcmFrames: OPUS_FRAME_SAMPLES,
          opus,
        });
        seq = (seq + 1) & 0xffff;
        self.postMessage({ type: "packet", buffer }, { transfer: [buffer] });
      } catch {
        // drop this frame
      }
    }

    const write = Atomics.load(ring.indices, RING_WRITE);
    await waitOn(ring.indices, RING_WRITE, write, 5);
  }
}

function waitOn(
  indices: Int32Array,
  index: number,
  value: number,
  timeoutMs: number,
): Promise<void> {
  const api = Atomics as typeof Atomics & {
    waitAsync?: (
      typedArray: Int32Array,
      i: number,
      v: number,
      timeout?: number,
    ) =>
      | { async: false; value: string }
      | { async: true; value: Promise<string> };
  };
  if (typeof api.waitAsync !== "function") {
    return new Promise((resolve) => setTimeout(resolve, timeoutMs));
  }
  const result = api.waitAsync(indices, index, value, timeoutMs);
  if (result.async) return result.value.then(() => undefined);
  return Promise.resolve();
}
