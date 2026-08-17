import {
  RING_CAPACITY,
  RING_FRAME,
  RING_HEADER_INTS,
  RING_PRIMED,
  RING_READ,
  RING_UNDERRUNS,
  RING_WRITE,
} from "./audio";

export type PcmRing = {
  sab: SharedArrayBuffer;
  indices: Int32Array;
  samples: Float32Array;
  capacity: number;
};

export function ringByteLength(capacity = RING_CAPACITY): number {
  return RING_HEADER_INTS * 4 + capacity * 4;
}

export function createPcmRing(capacity = RING_CAPACITY): PcmRing {
  const sab = new SharedArrayBuffer(ringByteLength(capacity));
  return attachPcmRing(sab, capacity);
}

export function attachPcmRing(
  sab: SharedArrayBuffer,
  capacity = RING_CAPACITY,
): PcmRing {
  return {
    sab,
    indices: new Int32Array(sab, 0, RING_HEADER_INTS),
    samples: new Float32Array(sab, RING_HEADER_INTS * 4, capacity),
    capacity,
  };
}

export function ringAvailable(ring: PcmRing): number {
  const write = Atomics.load(ring.indices, RING_WRITE);
  const read = Atomics.load(ring.indices, RING_READ);
  const used = write - read;
  if (used < 0 || used > ring.capacity) return 0;
  return used;
}

export function ringFree(ring: PcmRing): number {
  return ring.capacity - ringAvailable(ring);
}

export function ringWrite(
  ring: PcmRing,
  src: Float32Array,
  captureFrame?: number,
): number {
  const write = Atomics.load(ring.indices, RING_WRITE);
  const n = Math.min(src.length, ringFree(ring));
  if (n <= 0) return 0;
  copyInto(ring, write, src, n);
  if (captureFrame !== undefined) {
    Atomics.store(ring.indices, RING_FRAME, captureFrame);
  }
  Atomics.store(ring.indices, RING_WRITE, write + n);
  Atomics.notify(ring.indices, RING_WRITE);
  return n;
}

export function ringRead(ring: PcmRing, dst: Float32Array): number {
  const read = Atomics.load(ring.indices, RING_READ);
  const n = Math.min(dst.length, ringAvailable(ring));
  if (n <= 0) return 0;
  copyOut(ring, read, dst, n);
  Atomics.store(ring.indices, RING_READ, read + n);
  Atomics.notify(ring.indices, RING_READ);
  return n;
}

export function ringSkip(ring: PcmRing, count: number): number {
  const n = Math.min(count, ringAvailable(ring));
  if (n <= 0) return 0;
  const read = Atomics.load(ring.indices, RING_READ);
  Atomics.store(ring.indices, RING_READ, read + n);
  Atomics.notify(ring.indices, RING_READ);
  return n;
}

export function ringNoteUnderrun(ring: PcmRing): number {
  return Atomics.add(ring.indices, RING_UNDERRUNS, 1) + 1;
}

export function ringUnderruns(ring: PcmRing): number {
  return Atomics.load(ring.indices, RING_UNDERRUNS);
}

export function ringSetPrimed(ring: PcmRing, primed: boolean): void {
  Atomics.store(ring.indices, RING_PRIMED, primed ? 1 : 0);
}

export function ringPrimed(ring: PcmRing): boolean {
  return Atomics.load(ring.indices, RING_PRIMED) === 1;
}

export function ringCaptureFrame(ring: PcmRing): number {
  return Atomics.load(ring.indices, RING_FRAME);
}

function copyInto(
  ring: PcmRing,
  write: number,
  src: Float32Array,
  n: number,
): void {
  const start = ((write % ring.capacity) + ring.capacity) % ring.capacity;
  const first = Math.min(n, ring.capacity - start);
  ring.samples.set(src.subarray(0, first), start);
  if (first < n) ring.samples.set(src.subarray(first, n), 0);
}

function copyOut(
  ring: PcmRing,
  read: number,
  dst: Float32Array,
  n: number,
): void {
  const start = ((read % ring.capacity) + ring.capacity) % ring.capacity;
  const first = Math.min(n, ring.capacity - start);
  dst.set(ring.samples.subarray(start, start + first), 0);
  if (first < n) dst.set(ring.samples.subarray(0, n - first), first);
}
