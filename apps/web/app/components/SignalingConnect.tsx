"use client";

import { useEffect, useState } from "react";
import {
  isServerMessage,
  parseJsonMessage,
  type ClientMessage,
} from "@syncopate/shared";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8787/v1/ws";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function SignalingConnect() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [peerId, setPeerId] = useState<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    const handleOpen = () => {
      console.log("Connected to Syncopate Signaling Server");
      setStatus("connected");
      const hello: ClientMessage = { type: "hello" };
      ws.send(JSON.stringify(hello));
    };

    const handleMessage = (event: MessageEvent<string>) => {
      const payload = parseJsonMessage(event.data);
      if (isServerMessage(payload)) {
        setPeerId(payload.peerId);
      }
    };

    const handleClose = () => {
      setStatus("disconnected");
    };

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("message", handleMessage);
    ws.addEventListener("close", handleClose);

    return () => {
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("close", handleClose);
      ws.close();
    };
  }, []);

  return (
    <p className="font-mono text-sm text-zinc-500">
      signaling: {status}
      {peerId ? ` · peer ${peerId.slice(0, 8)}` : ""}
    </p>
  );
}
