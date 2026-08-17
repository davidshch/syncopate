import { describe, expect, it } from "vitest";
import {
  beatInBar,
  beatIndex,
  beatPhase,
  clickOnsetFrames,
  samplesPerBeat,
  slewEpochFrame,
} from "./beat";

describe("beat phase", () => {
  it("places clicks every 60/bpm seconds ± 1 sample at 48 kHz", () => {
    const sampleRate = 48_000;
    const bpm = 120;
    const spb = samplesPerBeat(sampleRate, bpm);
    expect(spb).toBe(24_000);

    const numerator = 4;
    const bars = 4;
    const endFrame = Math.round(bars * numerator * spb);
    const onsets = clickOnsetFrames({
      startFrame: 0,
      endFrame,
      epochFrame: 0,
      samplesPerBeat: spb,
    });

    expect(onsets).toHaveLength(bars * numerator);
    for (let i = 1; i < onsets.length; i++) {
      expect(Math.abs(onsets[i]! - onsets[i - 1]! - spb)).toBeLessThanOrEqual(1);
    }
    expect(onsets[0]).toBe(0);
  });

  it("accents beat 0 of each bar", () => {
    const spb = 24_000;
    for (const beat of [0, 1, 2, 3, 4]) {
      const frame = beat * spb;
      expect(beatInBar(frame, 0, spb, 4)).toBe(beat % 4);
    }
  });

  it("wraps negative frames before the epoch", () => {
    const spb = 24_000;
    expect(beatPhase(-1, 0, spb)).toBeCloseTo(spb - 1, 6);
  });

  it("computes beatIndex from server microseconds", () => {
    const bpm = 120;
    const epoch = 0;
    expect(beatIndex(0, epoch, bpm)).toBe(0);
    expect(beatIndex(499_999, epoch, bpm)).toBe(0);
    expect(beatIndex(500_000, epoch, bpm)).toBe(1);
  });
});

describe("PLL slew", () => {
  it("never jumps more than 0.1% of a quantum per step", () => {
    const quantum = 128;
    const next = slewEpochFrame(0, 10_000, quantum);
    expect(Math.abs(next)).toBeLessThanOrEqual(0.001 * quantum);
  });

  it("snaps when within 1 sample", () => {
    expect(slewEpochFrame(100, 100.4, 128)).toBe(100.4);
  });
});
