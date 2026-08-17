export type ClientMessage = {
  type: "hello";
};

export type ServerMessage = {
  type: "welcome";
  peerId: string;
};

export type WsMessage = ClientMessage | ServerMessage;

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (value as ClientMessage).type === "hello";
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as ServerMessage;
  return message.type === "welcome" && typeof message.peerId === "string";
}

export function parseJsonMessage(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
