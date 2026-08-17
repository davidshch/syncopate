import {
  RING_CAPACITY,
  createPcmRing,
  type PcmRing,
} from "@syncopate/shared";

export const MUSIC_AUDIO_CONSTRAINTS: MediaTrackConstraints & {
  voiceIsolation?: boolean;
  latency?: number;
} = {
  echoCancellation: false,
  autoGainControl: false,
  noiseSuppression: false,
  voiceIsolation: false,
  latency: 0,
  channelCount: 1,
  sampleRate: 48000,
};

export type PipelineStats = {
  packetLoss: number;
  underruns: number;
  bufferedMs: number;
  jitterMs: number;
  received: number;
  lost: number;
  primed: boolean;
  target: number;
};

type Clock = { offsetUs: number; audioOriginPerfUs: number };

export class AudioPipeline {
  private captureRing: PcmRing | null = null;
  private playbackRing: PcmRing | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private playbackNode: AudioWorkletNode | null = null;
  private encodeWorker: Worker | null = null;
  private decodeWorker: Worker | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private monitor: GainNode | null = null;
  private remoteGain: GainNode | null = null;
  private stream: MediaStream | null = null;
  private dc: RTCDataChannel | null = null;
  private workletsLoaded = false;
  stats: PipelineStats = emptyStats();
  private onStats: ((stats: PipelineStats) => void) | null = null;
  private onError: ((message: string) => void) | null = null;

  subscribeStats(listener: (stats: PipelineStats) => void): void {
    this.onStats = listener;
  }

  subscribeError(listener: (message: string) => void): void {
    this.onError = listener;
  }

  async start(ctx: AudioContext, stream: MediaStream): Promise<void> {
    this.stream = stream;
    await this.ensureWorklets(ctx);
    this.captureRing = createPcmRing(RING_CAPACITY);
    this.playbackRing = createPcmRing(RING_CAPACITY);

    this.captureNode = new AudioWorkletNode(ctx, "capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.playbackNode = new AudioWorkletNode(ctx, "playback-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.captureNode.port.postMessage({
      type: "init",
      sab: this.captureRing.sab,
      capacity: RING_CAPACITY,
    });
    this.playbackNode.port.postMessage({
      type: "init",
      sab: this.playbackRing.sab,
      capacity: RING_CAPACITY,
    });

    this.localSource = ctx.createMediaStreamSource(stream);
    this.monitor = ctx.createGain();
    this.monitor.gain.value = 1;
    this.remoteGain = ctx.createGain();
    this.remoteGain.gain.value = 1;

    this.localSource.connect(this.captureNode);
    this.localSource.connect(this.monitor);
    this.monitor.connect(ctx.destination);
    const captureMute = ctx.createGain();
    captureMute.gain.value = 0;
    this.captureNode.connect(captureMute);
    captureMute.connect(ctx.destination);
    this.playbackNode.connect(this.remoteGain);
    this.remoteGain.connect(ctx.destination);

    this.encodeWorker = new Worker("/workers/encode-worker.js", {
      type: "module",
    });
    this.decodeWorker = new Worker("/workers/decode-worker.js", {
      type: "module",
    });
    this.encodeWorker.postMessage({
      type: "init",
      sab: this.captureRing.sab,
      capacity: RING_CAPACITY,
    });
    this.decodeWorker.postMessage({
      type: "init",
      sab: this.playbackRing.sab,
      capacity: RING_CAPACITY,
    });

    this.encodeWorker.onerror = (event) => {
      this.onError?.(event.message || "encode worker failed");
    };
    this.decodeWorker.onerror = (event) => {
      this.onError?.(event.message || "decode worker failed");
    };

    this.encodeWorker.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        buffer?: ArrayBuffer;
        message?: string;
      };
      if (data.type === "error" && data.message) {
        this.onError?.(data.message);
        return;
      }
      if (data.type !== "packet" || !data.buffer) return;
      const channel = this.dc;
      if (!channel || channel.readyState !== "open") return;
      if (channel.bufferedAmount > 256_000) return;
      try {
        channel.send(data.buffer);
      } catch {
        // channel closing
      }
    };

    this.decodeWorker.onmessage = (event: MessageEvent) => {
      const data = event.data as Partial<PipelineStats> & {
        type?: string;
        message?: string;
      };
      if (data.type === "error" && data.message) {
        this.onError?.(data.message);
        return;
      }
      if (data.type !== "stats") return;
      this.stats = {
        packetLoss: data.packetLoss ?? 0,
        underruns: data.underruns ?? 0,
        bufferedMs: data.bufferedMs ?? 0,
        jitterMs: data.jitterMs ?? 0,
        received: data.received ?? 0,
        lost: data.lost ?? 0,
        primed: data.primed ?? false,
        target: data.target ?? 6,
      };
      this.onStats?.(this.stats);
    };
  }

  bindChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      this.decodeWorker?.postMessage({ type: "packet", buffer: event.data }, [
        event.data,
      ]);
    });
  }

  setClock(clock: Clock): void {
    this.encodeWorker?.postMessage({ type: "clock", ...clock });
  }

  resetRemote(): void {
    this.decodeWorker?.postMessage({ type: "reset" });
    this.stats = emptyStats();
    this.onStats?.(this.stats);
  }

  stop(): void {
    this.encodeWorker?.postMessage({ type: "stop" });
    this.decodeWorker?.postMessage({ type: "stop" });
    this.encodeWorker?.terminate();
    this.decodeWorker?.terminate();
    this.encodeWorker = null;
    this.decodeWorker = null;
    this.captureNode?.disconnect();
    this.playbackNode?.disconnect();
    this.localSource?.disconnect();
    this.monitor?.disconnect();
    this.remoteGain?.disconnect();
    this.captureNode = null;
    this.playbackNode = null;
    this.localSource = null;
    this.monitor = null;
    this.remoteGain = null;
    this.dc = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private async ensureWorklets(ctx: AudioContext): Promise<void> {
    if (this.workletsLoaded) return;
    await ctx.audioWorklet.addModule("/worklets/capture-processor.js");
    await ctx.audioWorklet.addModule("/worklets/playback-processor.js");
    this.workletsLoaded = true;
  }
}

export async function getMusicInput(): Promise<MediaStream> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: MUSIC_AUDIO_CONSTRAINTS,
      video: false,
    });
  } catch {
    const fallback = { ...MUSIC_AUDIO_CONSTRAINTS };
    delete fallback.voiceIsolation;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: fallback,
      video: false,
    });
  }

  for (const track of stream.getAudioTracks()) {
    track.contentHint = "music";
    try {
      await track.applyConstraints({
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
        channelCount: 1,
      });
    } catch {
      // device may not allow toggling APM
    }
  }

  return stream;
}

function emptyStats(): PipelineStats {
  return {
    packetLoss: 0,
    underruns: 0,
    bufferedMs: 0,
    jitterMs: 0,
    received: 0,
    lost: 0,
    primed: false,
    target: 6,
  };
}
