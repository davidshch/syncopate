import { describe, expect, it } from "vitest";
import {
  isClientMessage,
  isServerMessage,
  parseJsonMessage,
} from "./messages";

describe("signal client messages", () => {
  it("accepts offer, answer, and ice", () => {
    expect(
      isClientMessage({ type: "signal.offer", sdp: "v=0\r\n" }),
    ).toBe(true);
    expect(
      isClientMessage({ type: "signal.answer", sdp: "v=0\r\n" }),
    ).toBe(true);
    expect(
      isClientMessage({
        type: "signal.ice",
        candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
      }),
    ).toBe(true);
    expect(isClientMessage({ type: "signal.ice", candidate: null })).toBe(
      true,
    );
  });

  it("rejects empty sdp", () => {
    expect(isClientMessage({ type: "signal.offer", sdp: "" })).toBe(false);
  });
});

describe("signal server messages", () => {
  it("accepts welcome with role and iceServers", () => {
    expect(
      isServerMessage({
        type: "welcome",
        peerId: "a",
        role: "host",
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      }),
    ).toBe(true);
  });

  it("rejects legacy welcome without role", () => {
    expect(isServerMessage({ type: "welcome", peerId: "a" })).toBe(false);
  });

  it("accepts room and peer events", () => {
    expect(isServerMessage({ type: "room.full" })).toBe(true);
    expect(isServerMessage({ type: "peer.joined", peerId: "b" })).toBe(true);
    expect(isServerMessage({ type: "peer.left", peerId: "b" })).toBe(true);
    expect(isServerMessage({ type: "role", role: "host" })).toBe(true);
  });

  it("accepts relayed offer with from", () => {
    expect(
      isServerMessage({
        type: "signal.offer",
        from: "a",
        sdp: "v=0\r\n",
      }),
    ).toBe(true);
  });
});

describe("parseJsonMessage", () => {
  it("returns null on invalid json", () => {
    expect(parseJsonMessage("{")).toBeNull();
  });
});
