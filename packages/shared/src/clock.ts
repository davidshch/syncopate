export const WINDOW_SIZE = 16;
export const SERVER_HITCH_US = 2_000;
export const CLIENT_GAP_DRIFT_US = 8_000;
export const IIR_SNAP_US = 5_000;
export const IIR_ALPHA = 0.2;

export type ProbeTimes = {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
};

export type ProbeSample = {
  t0: number;
  rttUs: number;
  offsetUs: number;
  hitchUs: number;
};

export function probeStats(times: ProbeTimes): ProbeSample {
  const { t0, t1, t2, t3 } = times;
  return {
    t0,
    rttUs: t3 - t0 - (t2 - t1),
    offsetUs: ((t1 - t0) + (t2 - t3)) / 2,
    hitchUs: Math.abs(t2 - t1),
  };
}

/** Build a symmetric-delay probe: server = client + offsetUs. */
export function fakeSymmetricProbe(opts: {
  t0: number;
  offsetUs: number;
  oneWayUs: number;
  processUs?: number;
}): ProbeTimes {
  const processUs = opts.processUs ?? 0;
  const t1 = opts.t0 + opts.offsetUs + opts.oneWayUs;
  const t2 = t1 + processUs;
  const t3 = t2 - opts.offsetUs + opts.oneWayUs;
  return { t0: opts.t0, t1, t2, t3 };
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

export class OffsetEstimator {
  private samples: ProbeSample[] = [];
  private lastSendT0: number | null = null;
  private lastSendGapUs: number | null = null;
  smoothedOffsetUs: number | null = null;

  noteSend(t0: number): number | null {
    const gapUs = this.lastSendT0 === null ? null : t0 - this.lastSendT0;
    this.lastSendGapUs = gapUs;
    this.lastSendT0 = t0;
    return gapUs;
  }

  add(
    times: ProbeTimes,
    expectedGapUs: number,
    sendGapUs: number | null = this.lastSendGapUs,
  ): ProbeSample | null {
    const sample = probeStats(times);

    if (sample.hitchUs > SERVER_HITCH_US) return null;
    if (sample.rttUs < 0) return null;

    if (
      sendGapUs !== null &&
      Math.abs(sendGapUs - expectedGapUs) > CLIENT_GAP_DRIFT_US
    ) {
      return null;
    }

    this.samples.push(sample);
    if (this.samples.length > WINDOW_SIZE) this.samples.shift();

    const best = this.canonical();
    if (best === null) return null;

    if (
      this.smoothedOffsetUs === null ||
      Math.abs(best.offsetUs - this.smoothedOffsetUs) >= IIR_SNAP_US
    ) {
      this.smoothedOffsetUs = best.offsetUs;
    } else {
      this.smoothedOffsetUs =
        IIR_ALPHA * best.offsetUs + (1 - IIR_ALPHA) * this.smoothedOffsetUs;
    }

    return best;
  }

  canonical(): ProbeSample | null {
    if (this.samples.length === 0) return null;
    return this.samples.reduce((best, sample) =>
      sample.rttUs < best.rttUs ? sample : best,
    );
  }

  jitterUs(): number {
    return stddev(this.samples.map((sample) => sample.rttUs));
  }

  offsetSpreadUs(): number {
    if (this.samples.length === 0) return 0;
    const offsets = this.samples.map((sample) => sample.offsetUs);
    return Math.max(...offsets) - Math.min(...offsets);
  }

  sampleCount(): number {
    return this.samples.length;
  }
}

/** Pair output-stream contextTime with performance.now() (both from getOutputTimestamp). */
export function audioOriginFromOutputTimestamp(opts: {
  contextTime: number;
  performanceTime: number;
}): number {
  return opts.performanceTime * 1000 - opts.contextTime * 1e6;
}

export function serverTimeToAudioTime(
  serverUs: number,
  offsetUs: number,
  audioOriginPerfUs: number,
  outputLatencySec: number,
): number {
  return (serverUs - offsetUs - audioOriginPerfUs) / 1e6 - outputLatencySec;
}

export function epochFrameFromServer(opts: {
  epochServerUs: number;
  offsetUs: number;
  audioOriginPerfUs: number;
  outputLatencySec: number;
  sampleRate: number;
}): number {
  return Math.round(
    serverTimeToAudioTime(
      opts.epochServerUs,
      opts.offsetUs,
      opts.audioOriginPerfUs,
      opts.outputLatencySec,
    ) * opts.sampleRate,
  );
}
