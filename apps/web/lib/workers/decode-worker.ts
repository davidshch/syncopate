import { createDecoder } from "libopus-wasm";
import {
  DEJITTER_DEFAULT_PACKETS,
  OPUS_FRAME_SAMPLES,
  RING_READ,
  RING_WRITE,
  SAMPLE_RATE,
  attachPcmRing,
  decodeAudioPacket,
  DejitterBuffer,
  dejitterTargetFromJitterMs,
  ringAvailable,
  ringFree,
  ringSetPrimed,
  ringUnderruns,
  ringWrite,
} from "@syncopate/shared";

let running = false;
let decoder: Awaited<ReturnType<typeof createDecoder>> | null = null;
let ring: ReturnType<typeof attachPcmRing> | null = null;
const dejitter = new DejitterBuffer(DEJITTER_DEFAULT_PACKETS);
let lastArrivalMs = 0;
let jitterEmaMs = 5;
let packetsIn = 0;
let lastReportMs = 0;

self.onmessage = (event: MessageEvent) => {
  const data = event.data as
    | { type: "init"; sab: SharedArrayBuffer; capacity: number }
    | { type: "packet"; buffer: ArrayBuffer }
    | { type: "reset" }
    | { type: "stop" };

  if (data.type === "init") {
    ring = attachPcmRing(data.sab, data.capacity);
    void start();
    return;
  }
  if (data.type === "packet") {
    const packet = decodeAudioPacket(data.buffer);
    if (!packet) return;
    packetsIn += 1;
    const now = performance.now();
    if (lastArrivalMs > 0) {
      const delta = now - lastArrivalMs;
      jitterEmaMs = jitterEmaMs * 0.9 + Math.abs(delta - 5) * 0.1;
      dejitter.setTarget(dejitterTargetFromJitterMs(jitterEmaMs));
    }
    lastArrivalMs = now;
    dejitter.push(packet);
    fill();
    return;
  }
  if (data.type === "reset") {
    dejitter.reset();
    packetsIn = 0;
    lastArrivalMs = 0;
    if (ring) {
      Atomics.store(ring.indices, RING_WRITE, 0);
      Atomics.store(ring.indices, RING_READ, 0);
      ringSetPrimed(ring, false);
    }
    return;
  }
  if (data.type === "stop") {
    running = false;
    decoder?.free();
    decoder = null;
  }
};

async function start(): Promise<void> {
  try {
    decoder = await createDecoder({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      maxFrameSize: OPUS_FRAME_SAMPLES,
    });
    running = true;
    void loop();
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "opus decoder failed",
    });
  }
}

async function loop(): Promise<void> {
  while (running && ring) {
    fill();
    const read = Atomics.load(ring.indices, RING_READ);
    await waitOn(ring.indices, RING_READ, read, 5);
    report();
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

function fill(): void {
  if (!decoder || !ring) return;
  while (ringFree(ring) >= OPUS_FRAME_SAMPLES) {
    const fec = dejitter.peekFec();
    const item = dejitter.pull();
    if (item.kind === "wait") break;
    let pcm: Float32Array;
    try {
      if (item.kind === "packet") {
        pcm = decoder.decodeFloat(item.packet.opus, {
          frameSize: OPUS_FRAME_SAMPLES,
        });
      } else if (fec) {
        pcm = decoder.decodeFloat(fec.opus, {
          decodeFec: true,
          frameSize: OPUS_FRAME_SAMPLES,
        });
      } else {
        pcm = decoder.decodePacketLossFloat(OPUS_FRAME_SAMPLES);
      }
    } catch {
      pcm = decoder.decodePacketLossFloat(OPUS_FRAME_SAMPLES);
    }
    if (pcm.length >= OPUS_FRAME_SAMPLES) {
      ringWrite(ring, pcm.subarray(0, OPUS_FRAME_SAMPLES));
    } else {
      const padded = new Float32Array(OPUS_FRAME_SAMPLES);
      padded.set(pcm);
      ringWrite(ring, padded);
    }
  }
  if (dejitter.primed) ringSetPrimed(ring, true);
}

function report(): void {
  if (!ring) return;
  const now = performance.now();
  if (now - lastReportMs < 250) return;
  lastReportMs = now;
  self.postMessage({
    type: "stats",
    received: packetsIn,
    lost: dejitter.lost,
    packetLoss: dejitter.lossRatio(),
    underruns: ringUnderruns(ring),
    bufferedMs: (ringAvailable(ring) / SAMPLE_RATE) * 1000,
    jitterMs: jitterEmaMs,
    primed: dejitter.primed,
    target: dejitter.target,
  });
}
