/**
 * Capture: each quantum writes Float32 PCM into a SAB ring.
 * Keep index layout in sync with packages/shared/src/audio.ts
 */
const HEADER_INTS = 8;
const WRITE = 0;
const READ = 1;
const FRAME = 2;
const CAPACITY_DEFAULT = 16384;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.indices = null;
    this.samples = null;
    this.capacity = CAPACITY_DEFAULT;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type !== "init") return;
      this.capacity = data.capacity;
      this.indices = new Int32Array(data.sab, 0, HEADER_INTS);
      this.samples = new Float32Array(data.sab, HEADER_INTS * 4, this.capacity);
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || !this.indices || !this.samples) return true;

    const write = Atomics.load(this.indices, WRITE);
    const read = Atomics.load(this.indices, READ);
    const used = write - read;
    const free = this.capacity - (used < 0 || used > this.capacity ? this.capacity : used);
    const n = Math.min(input.length, Math.max(0, free));
    if (n <= 0) return true;

    const start = ((write % this.capacity) + this.capacity) % this.capacity;
    const first = Math.min(n, this.capacity - start);
    this.samples.set(input.subarray(0, first), start);
    if (first < n) this.samples.set(input.subarray(first, n), 0);

    Atomics.store(this.indices, FRAME, currentFrame);
    Atomics.store(this.indices, WRITE, write + n);
    Atomics.notify(this.indices, WRITE);
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
