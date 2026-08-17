import type {
  ClientMessage,
  IceCandidateInit,
  IceServer,
  PeerRole,
} from "@syncopate/shared";
import { DATA_CHANNEL_ID, DATA_CHANNEL_LABEL } from "@syncopate/shared";
import {
  AudioPipeline,
  getMusicInput,
  type PipelineStats,
} from "./audio-pipeline";

const STATS_INTERVAL_MS = 500;

export type PeerAudioUpdate = {
  audio: "off" | "starting" | "live";
  iceState: string | null;
  connectionState: string | null;
  webrtcRttMs: number | null;
  jitterBufferMs: number | null;
  packetLoss: number | null;
  underruns: number | null;
  remotePeerId: string | null;
  role: PeerRole | null;
  error?: string | null;
};

type Send = (message: ClientMessage) => void;
type OnUpdate = (update: Partial<PeerAudioUpdate>) => void;
type ClockFn = () => { offsetUs: number; audioOriginPerfUs: number } | null;

export class PeerAudio {
  role: PeerRole | null = null;
  remotePeerId: string | null = null;
  iceServers: IceServer[] = [];

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pipeline: AudioPipeline | null = null;
  private pendingOffer: string | null = null;
  private pendingIce: (IceCandidateInit | null)[] = [];
  private statsTimer: number | null = null;
  private enabled = false;
  private negotiating = false;

  constructor(
    private readonly send: Send,
    private readonly onUpdate: OnUpdate,
    private readonly audioContext: () => AudioContext | null,
    private readonly clock: ClockFn,
  ) {}

  setWelcome(role: PeerRole, iceServers: IceServer[]): void {
    this.role = role;
    this.iceServers = iceServers;
    this.onUpdate({ role });
  }

  setRole(role: PeerRole): void {
    this.role = role;
    this.onUpdate({ role });
  }

  pushClock(): void {
    const clock = this.clock();
    if (clock) this.pipeline?.setClock(clock);
  }

  async enable(): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;
    this.onUpdate({ audio: "starting", error: null });

    try {
      const ctx = this.audioContext();
      if (!ctx) throw new Error("audio context not ready");
      if (typeof SharedArrayBuffer === "undefined" || !crossOriginIsolated) {
        throw new Error("SharedArrayBuffer unavailable (need COOP/COEP)");
      }
      const stream = await getMusicInput();
      this.pipeline = new AudioPipeline();
      this.pipeline.subscribeStats((stats) => this.applyPipelineStats(stats));
      this.pipeline.subscribeError((message) => this.onUpdate({ error: message }));
      await this.pipeline.start(ctx, stream);
      this.pushClock();
      this.ensurePeerConnection();
      await this.flushSignaling();
      if (this.role === "host") await this.maybeOffer();
      this.onUpdate({ audio: "live" });
    } catch (error) {
      this.enabled = false;
      this.pipeline?.stop();
      this.pipeline = null;
      this.onUpdate({
        audio: "off",
        error:
          error instanceof Error ? error.message : "microphone access failed",
      });
    }
  }

  onPeerJoined(peerId: string): void {
    this.remotePeerId = peerId;
    this.onUpdate({ remotePeerId: peerId });
    if (this.enabled && this.role === "host") void this.maybeOffer();
  }

  onPeerLeft(): void {
    this.remotePeerId = null;
    this.pendingOffer = null;
    this.pendingIce = [];
    this.pipeline?.resetRemote();
    this.teardownPeerConnection();
    this.onUpdate({
      remotePeerId: null,
      iceState: null,
      connectionState: null,
      webrtcRttMs: null,
      jitterBufferMs: null,
      packetLoss: null,
      underruns: null,
    });
    if (this.enabled) this.ensurePeerConnection();
  }

  async onOffer(sdp: string): Promise<void> {
    if (!this.pc || !this.enabled) {
      this.pendingOffer = sdp;
      return;
    }
    try {
      await this.acceptOffer(sdp);
    } catch (error) {
      this.onUpdate({
        error: error instanceof Error ? error.message : "failed to accept offer",
      });
    }
  }

  async onAnswer(sdp: string): Promise<void> {
    if (!this.pc) return;
    if (this.pc.signalingState !== "have-local-offer") return;
    try {
      await this.pc.setRemoteDescription({ type: "answer", sdp });
      await this.flushIce();
    } catch (error) {
      this.onUpdate({
        error: error instanceof Error ? error.message : "failed to accept answer",
      });
    }
  }

  async onIce(candidate: IceCandidateInit | null): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate ?? undefined);
    } catch {
      // stale candidate
    }
  }

  close(): void {
    this.enabled = false;
    this.pendingOffer = null;
    this.pendingIce = [];
    this.remotePeerId = null;
    this.pipeline?.stop();
    this.pipeline = null;
    this.teardownPeerConnection();
    this.onUpdate({
      audio: "off",
      iceState: null,
      connectionState: null,
      webrtcRttMs: null,
      jitterBufferMs: null,
      packetLoss: null,
      underruns: null,
      remotePeerId: null,
    });
  }

  private ensurePeerConnection(): void {
    if (this.pc) return;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
    this.pc = pc;

    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, {
      ordered: false,
      maxRetransmits: 0,
      negotiated: true,
      id: DATA_CHANNEL_ID,
    });
    this.dc = dc;
    this.pipeline?.bindChannel(dc);

    pc.addEventListener("icecandidate", (event) => {
      this.send({
        type: "signal.ice",
        candidate: event.candidate
          ? {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              usernameFragment: event.candidate.usernameFragment,
            }
          : null,
      });
    });

    pc.addEventListener("iceconnectionstatechange", () => {
      this.onUpdate({ iceState: pc.iceConnectionState });
    });

    pc.addEventListener("connectionstatechange", () => {
      this.onUpdate({ connectionState: pc.connectionState });
      if (pc.connectionState === "failed") {
        this.onUpdate({ error: "WebRTC connection failed" });
      }
    });

    this.onUpdate({ iceState: pc.iceConnectionState });
    this.startStats();
  }

  private async maybeOffer(): Promise<void> {
    if (this.role !== "host" || !this.pc || !this.remotePeerId) return;
    if (this.negotiating || this.pc.signalingState !== "stable") return;

    this.negotiating = true;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.send({
        type: "signal.offer",
        sdp: this.pc.localDescription?.sdp ?? offer.sdp ?? "",
      });
    } finally {
      this.negotiating = false;
    }
  }

  private async acceptOffer(sdp: string): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription({ type: "offer", sdp });
    await this.flushIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.send({
      type: "signal.answer",
      sdp: this.pc.localDescription?.sdp ?? answer.sdp ?? "",
    });
  }

  private async flushSignaling(): Promise<void> {
    if (this.pendingOffer) {
      const offer = this.pendingOffer;
      this.pendingOffer = null;
      await this.acceptOffer(offer);
    }
  }

  private async flushIce(): Promise<void> {
    if (!this.pc) return;
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate ?? undefined);
      } catch {
        // stale candidate
      }
    }
  }

  private startStats(): void {
    this.stopStats();
    this.statsTimer = window.setInterval(() => {
      void this.pollStats();
    }, STATS_INTERVAL_MS);
  }

  private async pollStats(): Promise<void> {
    if (!this.pc) return;
    const stats = await this.pc.getStats();
    let rttMs: number | null = null;
    for (const report of stats.values()) {
      if (report.type !== "candidate-pair") continue;
      const pair = report as RTCIceCandidatePairStats;
      if (
        pair.state === "succeeded" &&
        pair.nominated &&
        typeof pair.currentRoundTripTime === "number"
      ) {
        rttMs = pair.currentRoundTripTime * 1000;
      }
    }
    this.onUpdate({ webrtcRttMs: rttMs });
  }

  private applyPipelineStats(stats: PipelineStats): void {
    this.onUpdate({
      jitterBufferMs: stats.bufferedMs,
      packetLoss: stats.packetLoss,
      underruns: stats.underruns,
    });
  }

  private stopStats(): void {
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  private teardownPeerConnection(): void {
    this.stopStats();
    this.dc?.close();
    this.dc = null;
    this.pc?.close();
    this.pc = null;
    this.negotiating = false;
  }
}
