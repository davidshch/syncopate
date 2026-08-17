export type GridBars = 1 | 4;

export type ClientMessage =
  | { type: "hello" }
  | { type: "clock.ping"; id: number; t0: number }
  | {
      type: "session.patch";
      bpm?: number;
      numerator?: number;
      denominator?: number;
      gridBars?: GridBars;
    };

export type ServerMessage =
  | { type: "welcome"; peerId: string }
  | { type: "clock.pong"; id: number; t0: number; t1: number; t2: number }
  | {
      type: "session.clock";
      bpm: number;
      numerator: number;
      denominator: number;
      gridBars: GridBars;
      epochServerUs: number;
      beatIndex: number;
    };

export type WsMessage = ClientMessage | ServerMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

  return false;
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "welcome") {
    return typeof value.peerId === "string";
  }

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

  return false;
}

export function parseJsonMessage(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
