import { describe, expect, it } from "vitest";
import { DejitterBuffer } from "./dejitter";
import type { AudioPacket } from "./packet";

function pkt(seq: number): AudioPacket {
  return {
    version: 1,
    flags: 0,
    seq,
    captureFrame: seq * 240,
    serverUs: seq * 5000,
    pcmFrames: 240,
    opus: new Uint8Array([seq & 0xff]),
  };
}

describe("DejitterBuffer", () => {
  it("waits until the target is primed then plays in order", () => {
    const buf = new DejitterBuffer(4);
    expect(buf.pull()).toEqual({ kind: "wait" });
    buf.push(pkt(10));
    buf.push(pkt(11));
    buf.push(pkt(12));
    expect(buf.pull()).toEqual({ kind: "wait" });
    buf.push(pkt(13));
    expect(buf.pull()).toMatchObject({ kind: "packet", packet: { seq: 10 } });
    expect(buf.pull()).toMatchObject({ kind: "packet", packet: { seq: 11 } });
  });

  it("emits PLC when a later packet confirms a gap", () => {
    const buf = new DejitterBuffer(4);
    for (const seq of [10, 12, 13, 14]) buf.push(pkt(seq));
    expect(buf.pull()).toEqual({ kind: "plc" });
    expect(buf.pull()).toMatchObject({ kind: "packet", packet: { seq: 12 } });
    expect(buf.lost).toBe(1);
  });

  it("drops late packets after the play head", () => {
    const buf = new DejitterBuffer(4);
    for (const seq of [10, 11, 12, 13]) buf.push(pkt(seq));
    expect(buf.pull()).toMatchObject({ kind: "packet", packet: { seq: 10 } });
    buf.push(pkt(9));
    expect(buf.size).toBe(3);
  });
});
