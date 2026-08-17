import {
  beatIndex,
  type GridBars,
  type ServerMessage,
} from "@syncopate/shared";
import { serverNowUs } from "./time";

export type SessionState = {
  bpm: number;
  numerator: number;
  denominator: number;
  gridBars: GridBars;
  epochServerUs: number;
};

export const session: SessionState = {
  bpm: 120,
  numerator: 4,
  denominator: 4,
  gridBars: 1,
  epochServerUs: serverNowUs(),
};

export function applyPatch(patch: {
  bpm?: number;
  numerator?: number;
  denominator?: number;
  gridBars?: GridBars;
}): boolean {
  let changed = false;

  if (patch.bpm !== undefined) {
    const bpm = Math.round(patch.bpm);
    if (bpm >= 20 && bpm <= 300 && bpm !== session.bpm) {
      session.bpm = bpm;
      changed = true;
    }
  }

  if (patch.numerator !== undefined) {
    const numerator = Math.round(patch.numerator);
    if (numerator >= 1 && numerator <= 16 && numerator !== session.numerator) {
      session.numerator = numerator;
      changed = true;
    }
  }

  if (patch.denominator !== undefined) {
    const denominator = Math.round(patch.denominator);
    if (
      [1, 2, 4, 8, 16].includes(denominator) &&
      denominator !== session.denominator
    ) {
      session.denominator = denominator;
      changed = true;
    }
  }

  if (
    patch.gridBars !== undefined &&
    patch.gridBars !== session.gridBars
  ) {
    session.gridBars = patch.gridBars;
    changed = true;
  }

  return changed;
}

export function clockMessage(): ServerMessage {
  return {
    type: "session.clock",
    bpm: session.bpm,
    numerator: session.numerator,
    denominator: session.denominator,
    gridBars: session.gridBars,
    epochServerUs: session.epochServerUs,
    beatIndex: beatIndex(serverNowUs(), session.epochServerUs, session.bpm),
  };
}
