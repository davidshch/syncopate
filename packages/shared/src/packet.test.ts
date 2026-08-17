import { describe, expect, it } from "vitest";
import { FLAG_PLC, OPUS_FRAME_SAMPLES } from "./audio";
import { decodeAudioPacket, encodeAudioPacket, seqDiff } from "./packet";

describe("audio packet codec", () => {
  it("round-trips header fields and opus bytes", () => {
    const opus = new Uint8Array([1, 2, 3, 9, 8, 7]);
    const encoded = encodeAudioPacket({
      flags: FLAG_PLC,
      seq: 40000,
      captureFrame: 123456,
      serverUs: 1_700_000_000_000_123,
      pcmFrames: OPUS_FRAME_SAMPLES,
      opus,
    });
    const decoded = decodeAudioPacket(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.flags).toBe(FLAG_PLC);
    expect(decoded!.seq).toBe(40000);
    expect(decoded!.captureFrame).toBe(123456);
    expect(decoded!.serverUs).toBe(1_700_000_000_000_123);
    expect(decoded!.pcmFrames).toBe(OPUS_FRAME_SAMPLES);
    expect([...decoded!.opus]).toEqual([1, 2, 3, 9, 8, 7]);
  });

  it("rejects truncated buffers", () => {
    expect(decodeAudioPacket(new ArrayBuffer(10))).toBeNull();
    const encoded = encodeAudioPacket({
      flags: 0,
      seq: 1,
      captureFrame: 0,
      serverUs: 0,
      pcmFrames: 240,
      opus: new Uint8Array([1, 2, 3]),
    });
    expect(decodeAudioPacket(encoded.slice(0, 21))).toBeNull();
  });
});

describe("seqDiff", () => {
  it("handles uint16 wrap", () => {
    expect(seqDiff(1, 65535)).toBe(2);
    expect(seqDiff(65535, 1)).toBe(-2);
    expect(seqDiff(10, 10)).toBe(0);
  });
});
