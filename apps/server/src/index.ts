import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  isClientMessage,
  parseJsonMessage,
  type IceServer,
  type ServerMessage,
} from "@syncopate/shared";
import { parseRoomId, Room, type SignalingSocket } from "./room";
import { applyPatch, clockMessage } from "./session";
import { serverNowUs } from "./time";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const WS_OPEN = 1;

const app = Fastify({ logger: true });
const rooms = new Map<string, Room>();

await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/healthz", async () => ({
  ok: true,
  service: "syncopate-signaling",
}));

function iceServers(): IceServer[] {
  const servers: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = process.env.TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      ...(process.env.TURN_USERNAME
        ? { username: process.env.TURN_USERNAME }
        : {}),
      ...(process.env.TURN_CREDENTIAL
        ? { credential: process.env.TURN_CREDENTIAL }
        : {}),
    });
  }
  return servers;
}

function getRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId);
    rooms.set(roomId, room);
  }
  return room;
}

function send(socket: SignalingSocket, message: ServerMessage): void {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(message: ServerMessage): void {
  const raw = JSON.stringify(message);
  for (const room of rooms.values()) {
    for (const peer of room.all()) {
      if (peer.socket.readyState === WS_OPEN) peer.socket.send(raw);
    }
  }
}

app.get("/v1/ws", { websocket: true }, (socket, request) => {
  const roomId = parseRoomId(request.query);
  const room = getRoom(roomId);
  const joined = room.tryJoin(socket as SignalingSocket);

  if (joined === "full") {
    send(socket as SignalingSocket, { type: "room.full" });
    socket.close();
    app.log.info({ roomId }, "room full");
    return;
  }

  send(socket as SignalingSocket, {
    type: "welcome",
    peerId: joined.id,
    role: joined.role,
    iceServers: iceServers(),
  });
  send(socket as SignalingSocket, clockMessage());

  const existing = room.other(joined.id);
  if (existing) {
    send(existing.socket, { type: "peer.joined", peerId: joined.id });
    send(socket as SignalingSocket, {
      type: "peer.joined",
      peerId: existing.id,
    });
  }

  app.log.info(
    { peerId: joined.id, role: joined.role, roomId, peers: room.size },
    "peer connected",
  );

  socket.on("message", (raw: Buffer | string) => {
    const t1 = serverNowUs();
    const text = typeof raw === "string" ? raw : raw.toString();
    const payload = parseJsonMessage(text);

    if (!isClientMessage(payload)) {
      app.log.warn(
        { peerId: joined.id, text },
        "ignored unrecognized client message",
      );
      return;
    }

    if (payload.type === "clock.ping") {
      const t2 = serverNowUs();
      send(socket as SignalingSocket, {
        type: "clock.pong",
        id: payload.id,
        t0: payload.t0,
        t1,
        t2,
      });
      return;
    }

    if (payload.type === "session.patch") {
      if (applyPatch(payload)) {
        broadcast(clockMessage());
        app.log.info({ peerId: joined.id, patch: payload }, "session patched");
      }
      return;
    }

    if (
      payload.type === "signal.offer" ||
      payload.type === "signal.answer" ||
      payload.type === "signal.ice"
    ) {
      const other = room.other(joined.id);
      if (!other) return;
      if (payload.type === "signal.ice") {
        send(other.socket, {
          type: "signal.ice",
          from: joined.id,
          candidate: payload.candidate,
        });
      } else {
        send(other.socket, {
          type: payload.type,
          from: joined.id,
          sdp: payload.sdp,
        });
      }
      return;
    }

    app.log.info({ peerId: joined.id, type: payload.type }, "client message");
  });

  socket.on("close", () => {
    room.leave(joined.id);
    const remaining = room.other(joined.id);
    if (remaining) {
      if (remaining.role === "host") {
        send(remaining.socket, { type: "role", role: "host" });
      }
      send(remaining.socket, { type: "peer.left", peerId: joined.id });
    } else {
      rooms.delete(roomId);
    }
    app.log.info(
      { peerId: joined.id, roomId, peers: room.size },
      "peer disconnected",
    );
  });
});

setInterval(() => {
  if (rooms.size === 0) return;
  broadcast(clockMessage());
}, 500);

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`signaling server listening on ws://${HOST}:${PORT}/v1/ws`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
