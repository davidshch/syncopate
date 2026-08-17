import {
  DEJITTER_DEFAULT_PACKETS,
  DEJITTER_MAX_PACKETS,
  DEJITTER_MIN_PACKETS,
} from "./audio";
import { seqAdd, seqDiff, type AudioPacket } from "./packet";

export type DejitterPull = { kind: "packet"; packet: AudioPacket } | { kind: "plc" } | { kind: "wait" };

export class DejitterBuffer {
  private pending = new Map<number, AudioPacket>();
  private nextSeq: number | null = null;
  private lastMaxSeq: number | null = null;
  target: number;
  received = 0;
  lost = 0;

  constructor(target = DEJITTER_DEFAULT_PACKETS) {
    this.target = clampTarget(target);
  }

  get primed(): boolean {
    return this.nextSeq !== null;
  }

  get size(): number {
    return this.pending.size;
  }

  setTarget(target: number): void {
    this.target = clampTarget(target);
  }

  reset(): void {
    this.pending.clear();
    this.nextSeq = null;
    this.lastMaxSeq = null;
    this.received = 0;
    this.lost = 0;
  }

  push(packet: AudioPacket): void {
    this.received += 1;
    if (this.nextSeq !== null && seqDiff(packet.seq, this.nextSeq) < 0) {
      return;
    }
    this.pending.set(packet.seq, packet);
    if (this.pending.size > 32) this.dropOldest();
    this.lastMaxSeq =
      this.lastMaxSeq === null || seqDiff(packet.seq, this.lastMaxSeq) > 0
        ? packet.seq
        : this.lastMaxSeq;
    if (this.nextSeq === null && this.pending.size >= this.target) {
      this.nextSeq = seqAdd(this.lastMaxSeq ?? packet.seq, 1 - this.target);
    }
  }

  pull(): DejitterPull {
    if (this.nextSeq === null) return { kind: "wait" };
    const packet = this.pending.get(this.nextSeq);
    if (packet) {
      this.pending.delete(this.nextSeq);
      this.nextSeq = seqAdd(this.nextSeq, 1);
      return { kind: "packet", packet };
    }
    const hasLater = this.hasLaterThan(this.nextSeq);
    if (!hasLater) return { kind: "wait" };
    this.lost += 1;
    this.nextSeq = seqAdd(this.nextSeq, 1);
    return { kind: "plc" };
  }

  peekNext(): AudioPacket | undefined {
    if (this.nextSeq === null) return undefined;
    return this.pending.get(this.nextSeq);
  }

  peekFec(): AudioPacket | undefined {
    if (this.nextSeq === null) return undefined;
    return this.pending.get(seqAdd(this.nextSeq, 1));
  }

  lossRatio(): number {
    const total = this.received + this.lost;
    if (total === 0) return 0;
    return this.lost / total;
  }

  private hasLaterThan(seq: number): boolean {
    for (const pendingSeq of this.pending.keys()) {
      if (seqDiff(pendingSeq, seq) > 0) return true;
    }
    return false;
  }

  private dropOldest(): void {
    let oldest: number | null = null;
    for (const seq of this.pending.keys()) {
      if (oldest === null || seqDiff(seq, oldest) < 0) oldest = seq;
    }
    if (oldest !== null) this.pending.delete(oldest);
  }
}

export function dejitterTargetFromJitterMs(jitterMs: number): number {
  const packets = Math.round(jitterMs / 5);
  return clampTarget(packets || DEJITTER_DEFAULT_PACKETS);
}

function clampTarget(target: number): number {
  return Math.min(
    DEJITTER_MAX_PACKETS,
    Math.max(DEJITTER_MIN_PACKETS, Math.round(target)),
  );
}
