import type { PeerRole } from "@syncopate/shared";

export const MAX_ROOM_PEERS = 2;

export type SignalingSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "message", listener: (raw: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
};

export type RoomPeer = {
  id: string;
  socket: SignalingSocket;
  role: PeerRole;
};

export class Room {
  readonly id: string;
  private readonly peers = new Map<string, RoomPeer>();

  constructor(id: string) {
    this.id = id;
  }

  get size(): number {
    return this.peers.size;
  }

  all(): RoomPeer[] {
    return [...this.peers.values()];
  }

  get(peerId: string): RoomPeer | undefined {
    return this.peers.get(peerId);
  }

  other(peerId: string): RoomPeer | undefined {
    for (const peer of this.peers.values()) {
      if (peer.id !== peerId) return peer;
    }
    return undefined;
  }

  tryJoin(socket: SignalingSocket): RoomPeer | "full" {
    if (this.peers.size >= MAX_ROOM_PEERS) return "full";
    const peer: RoomPeer = {
      id: crypto.randomUUID(),
      socket,
      role: this.peers.size === 0 ? "host" : "guest",
    };
    this.peers.set(peer.id, peer);
    return peer;
  }

  leave(peerId: string): RoomPeer | undefined {
    const leaving = this.peers.get(peerId);
    if (!leaving) return undefined;
    this.peers.delete(peerId);
    const remaining = this.other(peerId);
    if (remaining) remaining.role = "host";
    return leaving;
  }
}

export function parseRoomId(query: unknown): string {
  const raw =
    typeof query === "object" && query !== null && "roomId" in query
      ? String((query as { roomId?: unknown }).roomId ?? "")
      : "";
  const id = raw.trim().slice(0, 64);
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : "default";
}
