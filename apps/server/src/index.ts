import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  isClientMessage,
  parseJsonMessage,
  type ServerMessage,
} from "@syncopate/shared";
import { applyPatch, clockMessage } from "./session";
import { serverNowUs } from "./time";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const WS_OPEN = 1;

type SignalingSocket = {
  readyState: number;
  send(data: string): void;
  on(event: "message", listener: (raw: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
};

const app = Fastify({ logger: true });
const clients = new Set<SignalingSocket>();

await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/healthz", async () => ({
  ok: true,
  service: "syncopate-signaling",
}));

function send(socket: SignalingSocket, message: ServerMessage): void {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(message: ServerMessage): void {
  const raw = JSON.stringify(message);
  for (const socket of clients) {
    if (socket.readyState === WS_OPEN) socket.send(raw);
  }
}

app.get("/v1/ws", { websocket: true }, (socket) => {
  const peerId = crypto.randomUUID();
  clients.add(socket as SignalingSocket);

  send(socket, { type: "welcome", peerId });
  send(socket, clockMessage());
  app.log.info({ peerId, peers: clients.size }, "peer connected");

  socket.on("message", (raw: Buffer | string) => {
    const t1 = serverNowUs();
    const text = typeof raw === "string" ? raw : raw.toString();
    const payload = parseJsonMessage(text);

    if (!isClientMessage(payload)) {
      app.log.warn({ peerId, text }, "ignored unrecognized client message");
      return;
    }

    if (payload.type === "clock.ping") {
      const t2 = serverNowUs();
      send(socket, {
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
        app.log.info({ peerId, patch: payload }, "session patched");
      }
      return;
    }

    app.log.info({ peerId, type: payload.type }, "client message");
  });

  socket.on("close", () => {
    clients.delete(socket);
    app.log.info({ peerId, peers: clients.size }, "peer disconnected");
  });
});

setInterval(() => {
  if (clients.size === 0) return;
  broadcast(clockMessage());
}, 500);

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`signaling server listening on ws://${HOST}:${PORT}/v1/ws`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
