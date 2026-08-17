export type GridBars = 1 | 4;

export type PeerRole = "host" | "guest";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type IceCandidateInit = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type ClientMessage =
  | { type: "hello" }
  | { type: "clock.ping"; id: number; t0: number }
  | {
      type: "session.patch";
      bpm?: number;
      numerator?: number;
      denominator?: number;
      gridBars?: GridBars;
    }
  | { type: "signal.offer"; sdp: string }
  | { type: "signal.answer"; sdp: string }
  | { type: "signal.ice"; candidate: IceCandidateInit | null };

export type ServerMessage =
  | {
      type: "welcome";
      peerId: string;
      role: PeerRole;
      iceServers: IceServer[];
    }
  | { type: "room.full" }
  | { type: "peer.joined"; peerId: string }
  | { type: "peer.left"; peerId: string }
  | { type: "role"; role: PeerRole }
  | { type: "clock.pong"; id: number; t0: number; t1: number; t2: number }
  | {
      type: "session.clock";
      bpm: number;
      numerator: number;
      denominator: number;
      gridBars: GridBars;
      epochServerUs: number;
      beatIndex: number;
    }
  | { type: "signal.offer"; from: string; sdp: string }
  | { type: "signal.answer"; from: string; sdp: string }
  | { type: "signal.ice"; from: string; candidate: IceCandidateInit | null };

export type WsMessage = ClientMessage | ServerMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPeerRole(value: unknown): value is PeerRole {
  return value === "host" || value === "guest";
}

export function isIceServer(value: unknown): value is IceServer {
  if (!isRecord(value)) return false;
  const urls = value.urls;
  const urlsOk =
    typeof urls === "string" ||
    (Array.isArray(urls) && urls.every((entry) => typeof entry === "string"));
  if (!urlsOk) return false;
  if (value.username !== undefined && typeof value.username !== "string") {
    return false;
  }
  if (value.credential !== undefined && typeof value.credential !== "string") {
    return false;
  }
  return true;
}

export function isIceCandidateInit(
  value: unknown,
): value is IceCandidateInit {
  if (!isRecord(value)) return false;
  if (value.candidate !== undefined && typeof value.candidate !== "string") {
    return false;
  }
  if (
    value.sdpMid !== undefined &&
    value.sdpMid !== null &&
    typeof value.sdpMid !== "string"
  ) {
    return false;
  }
  if (
    value.sdpMLineIndex !== undefined &&
    value.sdpMLineIndex !== null &&
    !isFiniteNumber(value.sdpMLineIndex)
  ) {
    return false;
  }
  if (
    value.usernameFragment !== undefined &&
    value.usernameFragment !== null &&
    typeof value.usernameFragment !== "string"
  ) {
    return false;
  }
  return true;
}

function isSignalSdp(value: Record<string, unknown>): boolean {
  return typeof value.sdp === "string" && value.sdp.length > 0;
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "hello") return true;

  if (value.type === "clock.ping") {
    return isFiniteNumber(value.id) && isFiniteNumber(value.t0);
  }

  if (value.type === "session.patch") {
    if (value.bpm !== undefined && !isFiniteNumber(value.bpm)) return false;
    if (value.numerator !== undefined && !isFiniteNumber(value.numerator)) {
      return false;
    }
    if (value.denominator !== undefined && !isFiniteNumber(value.denominator)) {
      return false;
    }
    if (
      value.gridBars !== undefined &&
      value.gridBars !== 1 &&
      value.gridBars !== 4
    ) {
      return false;
    }
    return true;
  }

  if (value.type === "signal.offer" || value.type === "signal.answer") {
    return isSignalSdp(value);
  }

  if (value.type === "signal.ice") {
    return value.candidate === null || isIceCandidateInit(value.candidate);
  }

  return false;
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "welcome") {
    return (
      typeof value.peerId === "string" &&
      isPeerRole(value.role) &&
      Array.isArray(value.iceServers) &&
      value.iceServers.every(isIceServer)
    );
  }

  if (value.type === "room.full") return true;

  if (value.type === "peer.joined" || value.type === "peer.left") {
    return typeof value.peerId === "string";
  }

  if (value.type === "role") return isPeerRole(value.role);

  if (value.type === "clock.pong") {
    return (
      isFiniteNumber(value.id) &&
      isFiniteNumber(value.t0) &&
      isFiniteNumber(value.t1) &&
      isFiniteNumber(value.t2)
    );
  }

  if (value.type === "session.clock") {
    return (
      isFiniteNumber(value.bpm) &&
      isFiniteNumber(value.numerator) &&
      isFiniteNumber(value.denominator) &&
      (value.gridBars === 1 || value.gridBars === 4) &&
      isFiniteNumber(value.epochServerUs) &&
      isFiniteNumber(value.beatIndex)
    );
  }

  if (value.type === "signal.offer" || value.type === "signal.answer") {
    return typeof value.from === "string" && isSignalSdp(value);
  }

  if (value.type === "signal.ice") {
    return (
      typeof value.from === "string" &&
      (value.candidate === null || isIceCandidateInit(value.candidate))
    );
  }

  return false;
}

export function parseJsonMessage(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
