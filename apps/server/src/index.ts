import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  isClientMessage,
  parseJsonMessage,
  type ServerMessage,
} from "@syncopate/shared";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/healthz", async () => ({
  ok: true,
  service: "syncopate-signaling",
}));

app.get("/v1/ws", { websocket: true }, (socket) => {
  const peerId = crypto.randomUUID();

  const welcome: ServerMessage = { type: "welcome", peerId };
  socket.send(JSON.stringify(welcome));
  app.log.info({ peerId }, "peer connected");

  socket.on("message", (raw: Buffer | string) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    const payload = parseJsonMessage(text);

    if (!isClientMessage(payload)) {
      app.log.warn({ peerId, text }, "ignored unrecognized client message");
      return;
    }

    app.log.info({ peerId, type: payload.type }, "client message");
  });

  socket.on("close", () => {
    app.log.info({ peerId }, "peer disconnected");
  });
});

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`signaling server listening on ws://${HOST}:${PORT}/v1/ws`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
