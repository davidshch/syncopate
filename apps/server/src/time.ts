const bootWallMs = performance.timeOrigin + performance.now();
const bootHrNs = process.hrtime.bigint();

/** Monotonic session microseconds, Unix-aligned at process boot. */
export function serverNowUs(): number {
  const elapsedUs = Number(process.hrtime.bigint() - bootHrNs) / 1_000;
  return bootWallMs * 1_000 + elapsedUs;
}
