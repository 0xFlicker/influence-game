import type { PhaseKey, ViewerDecisionEvent } from "@/lib/api";
import type {
  FormatPresentationCompilation,
  FormatPresentationDiagnosticCode,
} from "./format-presentation-model";
import type {
  FormatPresentationCue,
  FormatPresentationSnapshot,
  FormatResolutionPresentation,
} from "./types";

export const FIXED_CUE_DURATION_MS = {
  empowered_tally: 2_400,
  format_menu: 3_000,
  format_selected: 3_600,
  safety_bounce_started: 2_400,
  format_aggregate: 3_200,
  format_tiebreak: 2_400,
  format_elimination: 3_200,
} satisfies Partial<Record<FormatPresentationCue["kind"], number>>;

export function incomplete(
  cues: readonly FormatPresentationCue[],
  snapshot: FormatPresentationSnapshot,
  code: FormatPresentationDiagnosticCode,
  sequence: number,
  message: string,
): FormatPresentationCompilation {
  return {
    status: "incomplete",
    cues: [...cues],
    snapshot: cloneSnapshot(snapshot),
    diagnostic: { code, sequence, message },
  };
}

export function cueKey(gameId: string, sequence: number, suffix: string): string {
  return `${gameId}:${sequence}:${suffix}`;
}

export function emptySnapshot(round = 0, phase: PhaseKey = "INIT"): FormatPresentationSnapshot {
  return {
    round,
    phase,
    canonicalSequence: 0,
    empoweredId: null,
    empoweredTally: null,
    offeredFormatIds: null,
    activeFormatId: null,
    safetyBounce: null,
    resolution: null,
    revealedBallots: [],
    eliminatedId: null,
  };
}

export function cloneSnapshot(snapshot: FormatPresentationSnapshot): FormatPresentationSnapshot {
  return {
    ...snapshot,
    empoweredTally: snapshot.empoweredTally ? { ...snapshot.empoweredTally } : null,
    offeredFormatIds: snapshot.offeredFormatIds ? [...snapshot.offeredFormatIds] : null,
    safetyBounce: snapshot.safetyBounce
      ? {
          ...snapshot.safetyBounce,
          safePlayerIds: [...snapshot.safetyBounce.safePlayerIds],
          vulnerablePlayerIds: [...snapshot.safetyBounce.vulnerablePlayerIds],
          benchPlayerIds: [...snapshot.safetyBounce.benchPlayerIds],
        }
      : null,
    resolution: snapshot.resolution ? cloneResolution(snapshot.resolution) : null,
    revealedBallots: snapshot.revealedBallots.map((ballot) => ({ ...ballot })),
  };
}

export function cloneResolution(
  resolution: FormatResolutionPresentation,
): FormatResolutionPresentation {
  return {
    ...resolution,
    tiedPlayerIds: [...resolution.tiedPlayerIds],
    saveOrEliminate: resolution.saveOrEliminate
      ? {
          nets: { ...resolution.saveOrEliminate.nets },
          savesReceived: { ...resolution.saveOrEliminate.savesReceived },
          eliminateReceived: { ...resolution.saveOrEliminate.eliminateReceived },
        }
      : null,
    voteBomb: resolution.voteBomb
      ? {
          totals: { ...resolution.voteBomb.totals },
          zeroSafePlayerIds: [...resolution.voteBomb.zeroSafePlayerIds],
        }
      : null,
    safetyBounce: resolution.safetyBounce
      ? {
          starterId: resolution.safetyBounce.starterId,
          safePlayerIds: [...resolution.safetyBounce.safePlayerIds],
          vulnerablePlayerIds: [...resolution.safetyBounce.vulnerablePlayerIds],
          voteTotals: { ...resolution.safetyBounce.voteTotals },
        }
      : null,
  };
}

export function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(record);
  return sameMembers(actualKeys, expectedKeys);
}

export function phaseKey(phase: ViewerDecisionEvent["phase"]): PhaseKey {
  return (phase ?? "INIT") as PhaseKey;
}
