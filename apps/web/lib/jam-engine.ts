import {
  epochFrameFromServer,
  OffsetEstimator,
  isServerMessage,
  parseJsonMessage,
  type ClientMessage,
  type GridBars,
  type ServerMessage,
} from "@syncopate/shared";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8787/v1/ws";
const BURST_COUNT = 8;
const BURST_GAP_US = 20_000;
const STEADY_GAP_US = 1_000_000;

export type HudSnapshot = {
  status: "disconnected" | "connecting" | "connected";
  peerId: string | null;
  rttMs: number | null;
  jitterMs: number | null;
  offsetMs: number | null;
  offsetSpreadMs: number | null;
  samples: number;
  bpm: number;
  numerator: number;
  denominator: number;
  gridBars: GridBars;
  beatInBar: number;
  playing: boolean;
  isolated: boolean;
  clickGain: number;
  ioLatencyMs: number | null;
  error: string | null;
};

const disconnectedSnapshot = (): HudSnapshot => ({
  status: "disconnected",
  peerId: null,
  rttMs: null,
  jitterMs: null,
  offsetMs: null,
  offsetSpreadMs: null,
  samples: 0,
  bpm: 120,
  numerator: 4,
  denominator: 4,
  gridBars: 1,
  beatInBar: 0,
  playing: false,
  isolated: false,
  clickGain: 0.45,
  ioLatencyMs: null,
  error: null,
});

export const SERVER_HUD_SNAPSHOT: HudSnapshot = disconnectedSnapshot();

type Listener = () => void;

export class JamEngine {
  private listeners = new Set<Listener>();
  private snapshot: HudSnapshot = disconnectedSnapshot();
  private refs = 0;
  private ws: WebSocket | null = null;
  private estimator = new OffsetEstimator();
  private probeId = 0;
  private inFlight = new Map<
    number,
    { expectedGapUs: number; sendGapUs: number | null }
  >();
  private timers: number[] = [];
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private workletReady = false;
  private session: Extract<ServerMessage, { type: "session.clock" }> | null =
    null;
  private audioOriginPerfUs = 0;
  private clickGain = 0.45;
  private playing = false;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): HudSnapshot => this.snapshot;

  start(): void {
    this.refs += 1;
    if (this.refs !== 1) return;
    this.connect();
  }

  stop(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs !== 0) return;
    this.disconnect();
  }

  async startMetronome(): Promise<void> {
    if (this.estimator.smoothedOffsetUs === null) {
      this.patch({ error: "clock offset not ready" });
      return;
    }
    try {
      await this.ensureWorklet();
      this.playing = true;
      this.pushSync();
      this.patch({ playing: true, error: null });
    } catch (error) {
      this.patch({
        error: error instanceof Error ? error.message : "audio init failed",
      });
    }
  }

  stopMetronome(): void {
    this.playing = false;
    this.pushSync();
    this.patch({ playing: false });
  }

  setClickGain(value: number): void {
    this.clickGain = Math.min(1, Math.max(0, value));
    this.pushSync();
    this.patch({ clickGain: this.clickGain });
  }

  setBpm(bpm: number): void {
    this.send({ type: "session.patch", bpm });
  }

  private connect(): void {
    this.estimator = new OffsetEstimator();
    this.probeId = 0;
    this.inFlight.clear();
    this.patch({
      ...disconnectedSnapshot(),
      status: "connecting",
      isolated:
        typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
    });

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.addEventListener("open", () => {
      console.log("Connected to Syncopate Signaling Server");
      this.patch({ status: "connected" });
      this.send({ type: "hello" });
      this.scheduleProbes();
    });

    ws.addEventListener("message", (event: MessageEvent<string>) => {
      this.onMessage(event.data);
    });

    ws.addEventListener("close", () => {
      this.clearTimers();
      if (this.ws === ws) {
        this.patch({ status: "disconnected", playing: false });
        this.playing = false;
      }
    });
  }

  private disconnect(): void {
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    void this.ctx?.close();
    this.ctx = null;
    this.node = null;
    this.workletReady = false;
    this.playing = false;
    this.patch(disconnectedSnapshot());
  }

  private onMessage(raw: string): void {
    const payload = parseJsonMessage(raw);
    if (!isServerMessage(payload)) return;

    if (payload.type === "welcome") {
      this.patch({ peerId: payload.peerId });
      return;
    }

    if (payload.type === "session.clock") {
      this.session = payload;
      this.pushSync();
      this.patch({
        bpm: payload.bpm,
        numerator: payload.numerator,
        denominator: payload.denominator,
        gridBars: payload.gridBars,
      });
      return;
    }

    const t3 = performance.now() * 1000;
    const pending = this.inFlight.get(payload.id);
    this.inFlight.delete(payload.id);
    if (!pending) return;

    const accepted = this.estimator.add(
      { t0: payload.t0, t1: payload.t1, t2: payload.t2, t3 },
      pending.expectedGapUs,
      pending.sendGapUs,
    );
    const offsetUs = this.estimator.smoothedOffsetUs;
    if (offsetUs === null) return;

    this.pushSync();
    this.patch({
      rttMs: (accepted?.rttUs ?? this.estimator.canonical()?.rttUs ?? 0) / 1000,
      jitterMs: this.estimator.jitterUs() / 1000,
      offsetMs: offsetUs / 1000,
      offsetSpreadMs: this.estimator.offsetSpreadUs() / 1000,
      samples: this.estimator.sampleCount(),
    });
  }

  private scheduleProbes(): void {
    this.clearTimers();
    let burst = 0;

    const sendBurst = () => {
      this.sendPing(BURST_GAP_US);
      burst += 1;
      if (burst < BURST_COUNT) {
        this.timers.push(window.setTimeout(sendBurst, BURST_GAP_US / 1000));
      } else {
        const steady = () => {
          this.sendPing(STEADY_GAP_US);
          this.timers.push(window.setTimeout(steady, STEADY_GAP_US / 1000));
        };
        this.timers.push(window.setTimeout(steady, STEADY_GAP_US / 1000));
      }
    };

    sendBurst();
  }

  private sendPing(expectedGapUs: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const id = this.probeId;
    this.probeId += 1;
    const t0 = performance.now() * 1000;
    const sendGapUs = this.estimator.noteSend(t0);
    this.inFlight.set(id, { expectedGapUs, sendGapUs });
    this.send({ type: "clock.ping", id, t0 });
  }

  private send(message: ClientMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private async ensureWorklet(): Promise<void> {
    const ctx =
      this.ctx ??
      new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    if (!this.workletReady) {
      await ctx.audioWorklet.addModule("/worklets/metronome-processor.js");
      const node = new AudioWorkletNode(ctx, "metronome-processor");
      node.port.onmessage = (event: MessageEvent) => {
        const data = event.data as {
          type?: string;
          beatInBar?: number;
          currentTime?: number;
        };
        if (data.type === "beat" && typeof data.beatInBar === "number") {
          this.patch({ beatInBar: data.beatInBar });
        }
        if (data.type === "clock" && typeof data.currentTime === "number") {
          this.audioOriginPerfUs =
            performance.now() * 1000 - data.currentTime * 1e6;
          this.pushSync();
        }
      };
      node.connect(ctx.destination);
      this.node = node;
      this.workletReady = true;
    }

    this.audioOriginPerfUs =
      performance.now() * 1000 - ctx.currentTime * 1e6;
    const outputLatency = ctx.outputLatency ?? ctx.baseLatency ?? 0;
    this.patch({ ioLatencyMs: (ctx.baseLatency + outputLatency) * 1000 });
  }

  private pushSync(): void {
    if (!this.node || !this.ctx || !this.session) return;
    const offsetUs = this.estimator.smoothedOffsetUs;
    if (offsetUs === null) return;

    const outputLatency = this.ctx.outputLatency ?? this.ctx.baseLatency ?? 0;
    const epochFrame = epochFrameFromServer({
      epochServerUs: this.session.epochServerUs,
      offsetUs,
      audioOriginPerfUs: this.audioOriginPerfUs,
      outputLatencySec: outputLatency,
      sampleRate: this.ctx.sampleRate,
    });

    this.node.port.postMessage({
      type: "sync",
      epochFrame,
      bpm: this.session.bpm,
      numerator: this.session.numerator,
      playing: this.playing,
      clickGain: this.clickGain,
    });
  }

  private clearTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
  }

  private patch(partial: Partial<HudSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }
}

let engine: JamEngine | null = null;

export function getJamEngine(): JamEngine {
  if (!engine) engine = new JamEngine();
  return engine;
}
