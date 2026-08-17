import { describe, expect, it } from "vitest";
import { createPcmRing, ringAvailable, ringRead, ringWrite } from "./ring";

describe("pcm ring", () => {
  it("writes and reads a contiguous block", () => {
    const ring = createPcmRing(32);
    const src = Float32Array.from([1, 2, 3, 4]);
    expect(ringWrite(ring, src)).toBe(4);
    expect(ringAvailable(ring)).toBe(4);
    const dst = new Float32Array(4);
    expect(ringRead(ring, dst)).toBe(4);
    expect([...dst]).toEqual([1, 2, 3, 4]);
    expect(ringAvailable(ring)).toBe(0);
  });

  it("wraps around the capacity", () => {
    const ring = createPcmRing(8);
    expect(ringWrite(ring, Float32Array.from([1, 2, 3, 4, 5, 6]))).toBe(6);
    const first = new Float32Array(4);
    expect(ringRead(ring, first)).toBe(4);
    expect(ringWrite(ring, Float32Array.from([7, 8, 9, 10]))).toBe(4);
    const rest = new Float32Array(6);
    expect(ringRead(ring, rest)).toBe(6);
    expect([...rest]).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("drops when full", () => {
    const ring = createPcmRing(4);
    expect(ringWrite(ring, Float32Array.from([1, 2, 3, 4, 5]))).toBe(4);
    expect(ringWrite(ring, Float32Array.from([6]))).toBe(0);
  });
});
