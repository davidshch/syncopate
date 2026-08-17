import {
  IIR_ALPHA,
  IIR_SNAP_US,
  OffsetEstimator,
  audioOriginFromOutputTimestamp,
  epochFrameFromServer,
  isServerMessage,
  parseJsonMessage,
  type ClientMessage,
  type GridBars,
  type PeerRole,
  type ServerMessage,
} from "@syncopate/shared";
import { PeerAudio } from "./webrtc";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8787/v1/ws";
const BURST_COUNT = 8;
const BURST_GAP_US = 20_000;
const STEADY_GAP_US = 1_000_000;

export type HudSnapshot = {
  status: "disconnected" | "connecting" | "connected";
  peerId: string | null;
  role: PeerRole | null;
  remotePeerId: string | null;
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
  audio: "off" | "starting" | "live";
  iceState: string | null;
  connectionState: string | null;
  webrtcRttMs: number | null;
  jitterBufferMs: number | null;
  packetLoss: number | null;
  underruns: number | null;
  error: string | null;
};

const disconnectedSnapshot = (): HudSnapshot => ({
  status: "disconnected",
  peerId: null,
  role: null,
  remotePeerId: null,
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
  audio: "off",
  iceState: null,
  connectionState: null,
  webrtcRttMs: null,
  jitterBufferMs: null,
  packetLoss: null,
  underruns: null,
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
  private audioOriginReady = false;
  private clickGain = 0.45;
  private playing = false;
  private peerAudio = new PeerAudio(
    (message) => this.send(message),
    (update) => this.patch(update),
    () => this.ctx,
    () => {
      if (this.estimator.smoothedOffsetUs === null) return null;
      return {
        offsetUs: this.estimator.smoothedOffsetUs,
        audioOriginPerfUs: this.audioOriginPerfUs,
      };
    },
  );

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
      await this.waitForOutputTimestamp();
      this.pushSync();
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

  async enableAudio(): Promise<void> {
    try {
      await this.ensureAudioContext();
      await this.peerAudio.enable();
    } catch (error) {
      this.patch({
        error: error instanceof Error ? error.message : "audio init failed",
      });
    }
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
        this.peerAudio.close();
        this.patch({ status: "disconnected", playing: false, audio: "off" });
        this.playing = false;
      }
    });
  }

  private disconnect(): void {
    this.clearTimers();
    this.peerAudio.close();
    this.ws?.close();
    this.ws = null;
    void this.ctx?.close();
    this.ctx = null;
    this.node = null;
    this.workletReady = false;
    this.playing = false;
    this.audioOriginReady = false;
    this.patch(disconnectedSnapshot());
  }

  private onMessage(raw: string): void {
    const payload = parseJsonMessage(raw);
    if (!isServerMessage(payload)) return;

    switch (payload.type) {
      case "welcome":
        this.peerAudio.setWelcome(payload.role, payload.iceServers);
        this.patch({ peerId: payload.peerId, role: payload.role });
        return;
      case "room.full":
        this.patch({
          error: "room is full (2 peers max)",
          status: "disconnected",
        });
        this.ws?.close();
        return;
      case "peer.joined":
        this.peerAudio.onPeerJoined(payload.peerId);
        return;
      case "peer.left":
        this.peerAudio.onPeerLeft();
        return;
      case "role":
        this.peerAudio.setRole(payload.role);
        return;
      case "signal.offer":
        void this.peerAudio.onOffer(payload.sdp);
        return;
      case "signal.answer":
        void this.peerAudio.onAnswer(payload.sdp);
        return;
      case "signal.ice":
        void this.peerAudio.onIce(payload.candidate);
        return;
      case "session.clock":
        this.session = payload;
        this.pushSync();
        this.patch({
          bpm: payload.bpm,
          numerator: payload.numerator,
          denominator: payload.denominator,
          gridBars: payload.gridBars,
        });
        return;
      case "clock.pong": {
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
        this.peerAudio.pushClock();
        this.patch({
          rttMs:
            (accepted?.rttUs ?? this.estimator.canonical()?.rttUs ?? 0) / 1000,
          jitterMs: this.estimator.jitterUs() / 1000,
          offsetMs: offsetUs / 1000,
          offsetSpreadMs: this.estimator.offsetSpreadUs() / 1000,
          samples: this.estimator.sampleCount(),
        });
        return;
      }
    }
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

  private async ensureAudioContext(): Promise<AudioContext> {
    const ctx =
      this.ctx ??
      new AudioContext({ latencyHint: 0, sampleRate: 48000 });
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    this.noteAudioOrigin(this.readAudioOriginPerfUs());
    this.patch({ ioLatencyMs: this.measuredOutputLatencyMs() });
    return ctx;
  }

  private async ensureWorklet(): Promise<void> {
    const ctx = await this.ensureAudioContext();

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
        if (data.type === "clock") {
          this.pushSync();
        }
      };
      node.connect(ctx.destination);
      this.node = node;
      this.workletReady = true;
    }
  }

  private readAudioOriginPerfUs(): number {
    if (!this.ctx) return 0;
    if (typeof this.ctx.getOutputTimestamp === "function") {
      const ts = this.ctx.getOutputTimestamp();
      const contextTime = ts.contextTime;
      const performanceTime = ts.performanceTime;
      if (
        typeof contextTime === "number" &&
        typeof performanceTime === "number" &&
        contextTime > 0 &&
        performanceTime > 0
      ) {
        return audioOriginFromOutputTimestamp({
          contextTime,
          performanceTime,
        });
      }
    }
    return performance.now() * 1000 - this.ctx.currentTime * 1e6;
  }

  private noteAudioOrigin(nextUs: number): void {
    if (
      !this.audioOriginReady ||
      Math.abs(nextUs - this.audioOriginPerfUs) >= IIR_SNAP_US
    ) {
      this.audioOriginPerfUs = nextUs;
      this.audioOriginReady = true;
      return;
    }
    this.audioOriginPerfUs =
      IIR_ALPHA * nextUs + (1 - IIR_ALPHA) * this.audioOriginPerfUs;
  }

  private measuredOutputLatencyMs(): number {
    if (!this.ctx) return 0;
    return ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
  }

  private waitForOutputTimestamp(): Promise<void> {
    if (!this.ctx) return Promise.resolve();
    const ctx = this.ctx;
    const deadline = performance.now() + 250;
    return new Promise((resolve) => {
      const poll = () => {
        const ts = ctx.getOutputTimestamp();
        if ((ts.contextTime ?? 0) > 0 || performance.now() >= deadline) {
          resolve();
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    });
  }

  private pushSync(): void {
    if (!this.node || !this.ctx || !this.session) return;
    const offsetUs = this.estimator.smoothedOffsetUs;
    if (offsetUs === null) return;

    this.noteAudioOrigin(this.readAudioOriginPerfUs());
    this.patch({ ioLatencyMs: this.measuredOutputLatencyMs() });

    const epochFrame = epochFrameFromServer({
      epochServerUs: this.session.epochServerUs,
      offsetUs,
      audioOriginPerfUs: this.audioOriginPerfUs,
      outputLatencySec: 0,
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
    this.peerAudio.pushClock();
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
