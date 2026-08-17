import { PACKET_HEADER_SIZE, PACKET_VERSION } from "./audio";

export type AudioPacket = {
  version: number;
  flags: number;
  seq: number;
  captureFrame: number;
  serverUs: number;
  pcmFrames: number;
  opus: Uint8Array;
};

export function encodeAudioPacket(packet: Omit<AudioPacket, "version">): ArrayBuffer {
  const payload = packet.opus;
  const buffer = new ArrayBuffer(PACKET_HEADER_SIZE + payload.byteLength);
  const view = new DataView(buffer);
  view.setUint8(0, PACKET_VERSION);
  view.setUint8(1, packet.flags);
  view.setUint16(2, packet.seq & 0xffff, true);
  view.setUint32(4, packet.captureFrame >>> 0, true);
  view.setBigUint64(8, BigInt(Math.round(packet.serverUs)), true);
  view.setUint16(16, packet.pcmFrames, true);
  view.setUint16(18, payload.byteLength, true);
  new Uint8Array(buffer, PACKET_HEADER_SIZE).set(payload);
  return buffer;
}

export function decodeAudioPacket(buffer: ArrayBuffer): AudioPacket | null {
  if (buffer.byteLength < PACKET_HEADER_SIZE) return null;
  const view = new DataView(buffer);
  const version = view.getUint8(0);
  if (version !== PACKET_VERSION) return null;
  const payloadLen = view.getUint16(18, true);
  if (buffer.byteLength < PACKET_HEADER_SIZE + payloadLen) return null;
  return {
    version,
    flags: view.getUint8(1),
    seq: view.getUint16(2, true),
    captureFrame: view.getUint32(4, true),
    serverUs: Number(view.getBigUint64(8, true)),
    pcmFrames: view.getUint16(16, true),
    opus: new Uint8Array(buffer, PACKET_HEADER_SIZE, payloadLen),
  };
}

export function packetMode(flags: number): 0 | 1 {
  return ((flags >> 2) & 0b11) === 1 ? 1 : 0;
}

/** Signed difference a-b on the uint16 sequence circle. */
export function seqDiff(a: number, b: number): number {
  return ((a - b) << 16) >> 16;
}

export function seqAdd(seq: number, delta: number): number {
  return (seq + delta) & 0xffff;
}
