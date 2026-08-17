"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getJamEngine, SERVER_HUD_SNAPSHOT } from "@/lib/jam-engine";

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
        <Stat
          label="peer"
          value={snap.peerId ? snap.peerId.slice(0, 8) : "—"}
        />
        <Stat
          label="isolated"
          value={snap.isolated ? "COOP/COEP" : "no"}
        />
        <Stat label="rtt" value={formatMs(snap.rttMs)} />
        <Stat label="jitter" value={formatMs(snap.jitterMs)} />
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
      ) : (
        <p className="text-sm text-zinc-500">
          Two browsers on this page share the same session epoch — clicks should
          stay within ~5 ms on a LAN.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-zinc-800 dark:text-zinc-200">{value}</dd>
    </div>
  );
}
