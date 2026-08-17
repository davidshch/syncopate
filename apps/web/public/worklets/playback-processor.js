/**
 * Playback: pull 128 samples from the SAB ring. Underrun → zeros.
 * Keep index layout in sync with packages/shared/src/audio.ts
 */
const HEADER_INTS = 8;
const WRITE = 0;
const READ = 1;
const UNDERRUNS = 3;
const PRIMED = 4;
const CAPACITY_DEFAULT = 16384;
const PRIME_SAMPLES = 6 * 240;

class PlaybackProcessor extends AudioWorkletProcessor {
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

  process(_inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    if (!this.indices || !this.samples) {
      out.fill(0);
      return true;
    }

    const write = Atomics.load(this.indices, WRITE);
    const read = Atomics.load(this.indices, READ);
    let available = write - read;
    if (available < 0 || available > this.capacity) available = 0;

    if (Atomics.load(this.indices, PRIMED) !== 1) {
      if (available >= PRIME_SAMPLES) Atomics.store(this.indices, PRIMED, 1);
      else {
        out.fill(0);
        return true;
      }
    }

    const n = Math.min(out.length, available);
    if (n > 0) {
      const start = ((read % this.capacity) + this.capacity) % this.capacity;
      const first = Math.min(n, this.capacity - start);
      out.set(this.samples.subarray(start, start + first), 0);
      if (first < n) out.set(this.samples.subarray(0, n - first), first);
      Atomics.store(this.indices, READ, read + n);
      Atomics.notify(this.indices, READ);
    }
    if (n < out.length) {
      out.fill(0, n);
      Atomics.add(this.indices, UNDERRUNS, 1);
    }
    return true;
  }
}

registerProcessor("playback-processor", PlaybackProcessor);
