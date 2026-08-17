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
    this.hasEpoch = false;
    this.targetEpochFrame = null;
    this.pendingSnap = null;
    this.bpm = 120;
    this.numerator = 4;
    this.playing = false;
    this.clickGain = 0.45;
    this.clickLen = 64;
    this.clockQuantum = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type !== "sync") return;

      if (typeof data.epochFrame === "number") {
        const next = data.epochFrame;
        const error = Math.abs(next - this.epochFrame);
        const snap =
          !this.hasEpoch || !this.playing || error <= 64;
        const hardSnap = this.hasEpoch && this.playing && error > 240;
        if (snap) {
          this.epochFrame = next;
          this.targetEpochFrame = null;
          this.pendingSnap = null;
          this.hasEpoch = true;
        } else if (hardSnap) {
          this.pendingSnap = next;
          this.targetEpochFrame = null;
        } else {
          this.targetEpochFrame = next;
          this.pendingSnap = null;
        }
      }

      if (typeof data.bpm === "number") this.bpm = data.bpm;
      if (typeof data.numerator === "number") this.numerator = data.numerator;
      if (typeof data.playing === "boolean") this.playing = data.playing;
      if (typeof data.clickGain === "number") this.clickGain = data.clickGain;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;

    const quantum = out.length;
    const spb = (sampleRate * 60) / this.bpm;
    const clickLen = this.clickLen;

    if (this.pendingSnap !== null) {
      const phase = posMod(currentFrame - this.epochFrame, spb);
      if (!this.playing || phase >= clickLen) {
        this.epochFrame = this.pendingSnap;
        this.pendingSnap = null;
      }
    }

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

    for (let i = 0; i < quantum; i++) {
      if (!this.playing || !this.hasEpoch) {
        out[i] = 0;
        continue;
      }

      const frame = currentFrame + i;
      const delta = frame - this.epochFrame;
      const phase = posMod(delta, spb);
      const prev = posMod(delta - 1, spb);

      if (phase < clickLen) {
        const n = phase;
        const beats = Math.floor(delta / spb);
        const beatInBar = posMod(beats, this.numerator);
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
    if (this.clockQuantum === 1 || this.clockQuantum >= 187) {
      if (this.clockQuantum >= 187) this.clockQuantum = 1;
      this.port.postMessage({
        type: "clock",
        currentFrame,
        currentTime,
      });
    }

    return true;
  }
}

function posMod(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

registerProcessor("metronome-processor", MetronomeProcessor);
