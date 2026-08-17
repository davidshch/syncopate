import { describe, expect, it } from "vitest";
import {
  CLIENT_GAP_DRIFT_US,
  IIR_SNAP_US,
  OffsetEstimator,
  SERVER_HITCH_US,
  fakeSymmetricProbe,
  probeStats,
  serverTimeToAudioTime,
} from "./clock";

describe("probeStats", () => {
  it("recovers offset within 1 ms on a symmetric delay", () => {
    const offsetUs = 3_000;
    const times = fakeSymmetricProbe({
      t0: 10_000,
      offsetUs,
      oneWayUs: 10_000,
      processUs: 40,
    });
    const sample = probeStats(times);
    expect(Math.abs(sample.offsetUs - offsetUs)).toBeLessThan(1_000);
    expect(sample.rttUs).toBeCloseTo(20_000, 6);
  });
});

describe("OffsetEstimator", () => {
  it("picks the min-RTT sample and ignores a 50 ms outlier", () => {
    const estimator = new OffsetEstimator();
    const trueOffset = 2_000;

    for (let i = 0; i < 8; i++) {
      const t0 = i * 20_000;
      estimator.noteSend(t0);
      estimator.add(
        fakeSymmetricProbe({
          t0,
          offsetUs: trueOffset,
          oneWayUs: 1_000 + i * 50,
        }),
        20_000,
      );
    }

    const outlierT0 = 8 * 20_000;
    estimator.noteSend(outlierT0);
    estimator.add(
      fakeSymmetricProbe({
        t0: outlierT0,
        offsetUs: trueOffset + 40_000,
        oneWayUs: 50_000,
      }),
      20_000,
    );

    const canonical = estimator.canonical();
    expect(canonical).not.toBeNull();
    expect(canonical!.rttUs).toBeLessThan(5_000);
    expect(Math.abs(canonical!.offsetUs - trueOffset)).toBeLessThan(1_000);
    expect(
      Math.abs((estimator.smoothedOffsetUs ?? 0) - trueOffset),
    ).toBeLessThan(1_000);
  });

  it("rejects probes with a server hitch over 2 ms", () => {
    const estimator = new OffsetEstimator();
    const t0 = 0;
    estimator.noteSend(t0);
    const accepted = estimator.add(
      fakeSymmetricProbe({
        t0,
        offsetUs: 0,
        oneWayUs: 1_000,
        processUs: SERVER_HITCH_US + 500,
      }),
      20_000,
    );
    expect(accepted).toBeNull();
    expect(estimator.sampleCount()).toBe(0);
  });

  it("rejects a send-gap GC pause over 8 ms", () => {
    const estimator = new OffsetEstimator();
    estimator.noteSend(0);
    estimator.add(
      fakeSymmetricProbe({ t0: 0, offsetUs: 0, oneWayUs: 1_000 }),
      20_000,
    );
    estimator.noteSend(20_000 + CLIENT_GAP_DRIFT_US + 1_000);
    const accepted = estimator.add(
      fakeSymmetricProbe({
        t0: 20_000 + CLIENT_GAP_DRIFT_US + 1_000,
        offsetUs: 0,
        oneWayUs: 1_000,
      }),
      20_000,
    );
    expect(accepted).toBeNull();
    expect(estimator.sampleCount()).toBe(1);
  });

  it("hard-snaps when offset jumps by more than 5 ms", () => {
    const estimator = new OffsetEstimator();
    estimator.noteSend(0);
    estimator.add(
      fakeSymmetricProbe({ t0: 0, offsetUs: 1_000, oneWayUs: 800 }),
      20_000,
    );
    expect(estimator.smoothedOffsetUs).toBeCloseTo(1_000, 0);

    estimator.noteSend(20_000);
    estimator.add(
      fakeSymmetricProbe({
        t0: 20_000,
        offsetUs: 1_000 + IIR_SNAP_US + 2_000,
        oneWayUs: 500,
      }),
      20_000,
    );
    expect(estimator.smoothedOffsetUs).toBeGreaterThan(IIR_SNAP_US);
  });
});

describe("serverTimeToAudioTime", () => {
  it("maps server time through offset onto audio time", () => {
    const audio = serverTimeToAudioTime(2_000_000, 500_000, 1_000_000, 0.005);
    expect(audio).toBeCloseTo(0.495, 6);
  });
});
