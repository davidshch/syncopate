"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  getJamEngine,
  SERVER_HUD_SNAPSHOT,
  type HudSnapshot,
} from "@/lib/jam-engine";

function formatMs(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return `${value.toFixed(digits)} ms`;
}

export function Hud() {
  const engine = getJamEngine();
  const snap = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    () => SERVER_HUD_SNAPSHOT,
  );

  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm text-zinc-600 dark:text-zinc-400 sm:grid-cols-3">
        <Stat label="signaling" value={snap.status} />
        <Stat label="role" value={snap.role ?? "—"} />
        <Stat
          label="you"
          value={snap.peerId ? snap.peerId.slice(0, 8) : "—"}
        />
        <Stat
          label="remote"
          value={snap.remotePeerId ? snap.remotePeerId.slice(0, 8) : "waiting"}
        />
        <Stat
          label="isolated"
          value={snap.isolated ? "COOP/COEP" : "no"}
        />
        <Stat label="clock rtt" value={formatMs(snap.rttMs)} />
        <Stat label="clock jitter" value={formatMs(snap.jitterMs)} />
        <Stat label="offset" value={formatMs(snap.offsetMs)} />
        <Stat
          label="offset σ"
          value={
            snap.offsetSpreadMs === null
              ? "—"
              : `${snap.offsetSpreadMs.toFixed(2)} ms${
                  snap.offsetSpreadMs <= 2 ? " · stable" : ""
                }`
          }
        />
        <Stat label="probes" value={`${snap.samples}/16`} />
        <Stat label="audio I/O" value={formatMs(snap.ioLatencyMs)} />
        <Stat label="audio" value={snap.audio} />
        <Stat label="mode" value={snap.audio === "live" ? "LIVE" : "—"} />
        <Stat label="ice" value={snap.iceState ?? "—"} />
        <Stat label="ping" value={formatMs(snap.webrtcRttMs)} />
        <Stat label="jb delay" value={formatMs(snap.jitterBufferMs)} />
        <Stat
          label="loss"
          value={
            snap.packetLoss === null
              ? "—"
              : `${(snap.packetLoss * 100).toFixed(1)}%`
          }
        />
        <Stat
          label="underruns"
          value={snap.underruns === null ? "—" : `${snap.underruns}`}
        />
        <Stat label="m2e est." value={formatMs(estimateM2e(snap))} />
      </dl>

      <div className="flex items-end gap-3">
        {Array.from({ length: snap.numerator }, (_, beat) => (
          <div
            key={beat}
            className={`h-10 w-10 rounded-full border-2 transition-transform ${
              snap.playing && snap.beatInBar === beat
                ? beat === 0
                  ? "scale-110 border-zinc-900 bg-zinc-900 dark:border-zinc-50 dark:bg-zinc-50"
                  : "scale-105 border-zinc-500 bg-zinc-500"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          />
        ))}
        <p className="font-mono text-sm text-zinc-500">
          {snap.beatInBar + 1}/{snap.numerator} · {snap.bpm} BPM ·{" "}
          {snap.numerator}/{snap.denominator}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void engine.enableAudio()}
          disabled={snap.status !== "connected" || snap.audio !== "off"}
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
        >
          {snap.audio === "live"
            ? "Audio live"
            : snap.audio === "starting"
              ? "Starting audio…"
              : "Enable audio"}
        </button>
        <button
          type="button"
          onClick={() =>
            snap.playing ? engine.stopMetronome() : void engine.startMetronome()
          }
          disabled={snap.offsetMs === null || snap.status !== "connected"}
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
        >
          {snap.playing ? "Stop metronome" : "Start metronome"}
        </button>
        <label className="flex items-center gap-2 font-mono text-sm text-zinc-500">
          BPM
          <input
            type="number"
            min={20}
            max={300}
            value={snap.bpm}
            onChange={(event) => engine.setBpm(Number(event.target.value))}
            className="w-20 rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          />
        </label>
        <label className="flex items-center gap-2 font-mono text-sm text-zinc-500">
          click
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={snap.clickGain}
            onChange={(event) =>
              engine.setClickGain(Number(event.target.value))
            }
          />
        </label>
      </div>

      {snap.error ? (
        <p className="text-sm text-red-600">{snap.error}</p>
      ) : snap.audio === "live" ? (
        <p className="text-sm text-zinc-500">
          Headphones required — echo cancellation is off. You hear yourself
          dry; remote audio is Opus 5 ms frames over an unordered DataChannel.
          Two tabs on one machine will echo your voice back.
        </p>
      ) : snap.playing ? (
        <p className="text-sm text-zinc-500">
          Both tabs click from the same server epoch. Start the metronome on
          each; they should lock even if you press the buttons seconds apart.
        </p>
      ) : (
        <p className="text-sm text-zinc-500">
          Open this page in two Chrome tabs, enable audio on both, and grant
          microphone access. Host (first tab) sends the SDP offer.
        </p>
      )}
    </div>
  );
}

function estimateM2e(snap: HudSnapshot): number | null {
  if (snap.ioLatencyMs === null || snap.jitterBufferMs === null) return null;
  const oneWay = snap.webrtcRttMs === null ? 0 : snap.webrtcRttMs / 2;
  return snap.ioLatencyMs + 5 + oneWay + snap.jitterBufferMs;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-zinc-800 dark:text-zinc-200">{value}</dd>
    </div>
  );
}
