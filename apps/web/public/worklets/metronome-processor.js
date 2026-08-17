/**
 * Sample-accurate metronome. Clicks are generated from (currentFrame - epochFrame)
 * modulo samplesPerBeat — never from setTimeout / OscillatorNode.
 *
 * Main thread messages:
 *   { type: "sync", epochFrame, bpm, numerator, playing, clickGain }
 * Worklet messages:
 *   { type: "clock", currentFrame, currentTime }
 *   { type: "beat", beatInBar, accent }
 */
class MetronomeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.epochFrame = 0;
    this.targetEpochFrame = null;
    this.bpm = 120;
    this.numerator = 4;
    this.playing = false;
    this.clickGain = 0.45;
    this.clickLen = 64;
    this.clockQuantum = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type !== "sync") return;
      if (typeof data.bpm === "number") this.bpm = data.bpm;
      if (typeof data.numerator === "number") this.numerator = data.numerator;
      if (typeof data.playing === "boolean") this.playing = data.playing;
      if (typeof data.clickGain === "number") this.clickGain = data.clickGain;
      if (typeof data.epochFrame === "number") {
        const next = data.epochFrame;
        if (!this.playing || Math.abs(next - this.epochFrame) <= 64) {
          this.epochFrame = next;
          this.targetEpochFrame = null;
        } else {
          this.targetEpochFrame = next;
        }
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;

    const quantum = out.length;
    if (this.targetEpochFrame !== null) {
      const error = this.targetEpochFrame - this.epochFrame;
      const maxStep = 0.001 * quantum;
      if (Math.abs(error) <= 1) {
        this.epochFrame = this.targetEpochFrame;
        this.targetEpochFrame = null;
      } else if (error > 0) {
        this.epochFrame += Math.min(maxStep, error);
      } else {
        this.epochFrame += Math.max(-maxStep, error);
      }
    }

    const spb = (sampleRate * 60) / this.bpm;
    const clickLen = this.clickLen;

    for (let i = 0; i < quantum; i++) {
      if (!this.playing) {
        out[i] = 0;
        continue;
      }

      const frame = currentFrame + i;
      const delta = frame - this.epochFrame;
      let phase = delta % spb;
      if (phase < 0) phase += spb;
      let prev = (delta - 1) % spb;
      if (prev < 0) prev += spb;

      if (phase < clickLen) {
        const n = phase;
        const beats = Math.floor(delta / spb);
        const beatInBar = ((beats % this.numerator) + this.numerator) % this.numerator;
        const accent = beatInBar === 0;
        const freq = accent ? 2000 : 1000;
        const amp = (accent ? 1 : 0.55) * this.clickGain;
        out[i] =
          Math.sin((2 * Math.PI * freq * n) / sampleRate) *
          Math.exp(-n / 12) *
          amp;
        if (prev >= clickLen) {
          this.port.postMessage({ type: "beat", beatInBar, accent });
        }
      } else {
        out[i] = 0;
      }
    }

    this.clockQuantum += 1;
    if (this.clockQuantum >= 187) {
      this.clockQuantum = 0;
      this.port.postMessage({
        type: "clock",
        currentFrame,
        currentTime,
      });
    }

    return true;
  }
}

registerProcessor("metronome-processor", MetronomeProcessor);
