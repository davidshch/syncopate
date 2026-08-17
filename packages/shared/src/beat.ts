export const DEFAULT_CLICK_LEN = 64;
export const MAX_TEMPO_ERROR = 0.001;
export const EPOCH_SNAP_SAMPLES = 64;
export const EPOCH_HARD_SNAP_SAMPLES = 240;

export type EpochUpdateMode = "snap" | "slew" | "hard-snap";

/** First lock and stopped clock snap; small drift slews; >5 ms hard-snaps. */
export function epochUpdateMode(opts: {
  current: number;
  next: number;
  hasEpoch: boolean;
  playing: boolean;
}): EpochUpdateMode {
  if (!opts.hasEpoch || !opts.playing) return "snap";
  const error = Math.abs(opts.next - opts.current);
  if (error <= EPOCH_SNAP_SAMPLES) return "snap";
  if (error > EPOCH_HARD_SNAP_SAMPLES) return "hard-snap";
  return "slew";
}

export function samplesPerBeat(sampleRate: number, bpm: number): number {
  return (sampleRate * 60) / bpm;
}

export function beatPeriodUs(bpm: number): number {
  return (60 / bpm) * 1e6;
}

export function beatIndex(
  serverUs: number,
  epochServerUs: number,
  bpm: number,
): number {
  return Math.floor((serverUs - epochServerUs) / beatPeriodUs(bpm));
}

export function posMod(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

export function beatPhase(
  currentFrame: number,
  epochFrame: number,
  samplesPerBeatValue: number,
): number {
  return posMod(currentFrame - epochFrame, samplesPerBeatValue);
}

export function isClickSample(
  phase: number,
  clickLen = DEFAULT_CLICK_LEN,
): boolean {
  return phase >= 0 && phase < clickLen;
}

export function beatInBar(
  currentFrame: number,
  epochFrame: number,
  samplesPerBeatValue: number,
  numerator: number,
): number {
  const beats = Math.floor((currentFrame - epochFrame) / samplesPerBeatValue);
  return posMod(beats, numerator);
}

export function isBeatStart(
  currentFrame: number,
  epochFrame: number,
  samplesPerBeatValue: number,
  clickLen = DEFAULT_CLICK_LEN,
): boolean {
  const phase = beatPhase(currentFrame, epochFrame, samplesPerBeatValue);
  const prev = beatPhase(currentFrame - 1, epochFrame, samplesPerBeatValue);
  return isClickSample(phase, clickLen) && prev >= clickLen;
}

export function clickOnsetFrames(opts: {
  startFrame: number;
  endFrame: number;
  epochFrame: number;
  samplesPerBeat: number;
  clickLen?: number;
}): number[] {
  const clickLen = opts.clickLen ?? DEFAULT_CLICK_LEN;
  const frames: number[] = [];
  for (let frame = opts.startFrame; frame < opts.endFrame; frame++) {
    if (isBeatStart(frame, opts.epochFrame, opts.samplesPerBeat, clickLen)) {
      frames.push(frame);
    }
  }
  return frames;
}

/** Slew epoch by at most ±0.1% of sample rate per second (per quantum). */
export function slewEpochFrame(
  current: number,
  target: number,
  quantum: number,
  maxTempoError = MAX_TEMPO_ERROR,
): number {
  const error = target - current;
  if (Math.abs(error) <= 1) return target;
  const maxStep = maxTempoError * quantum;
  if (error > 0) return current + Math.min(maxStep, error);
  return current + Math.max(-maxStep, error);
}
