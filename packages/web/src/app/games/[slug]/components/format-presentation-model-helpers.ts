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
  two_names_empowered_intro: 2_200,
  two_names_initial_names: 3_600,
  two_names_override_draw: 2_800,
  two_names_mingle_complete: 1_250,
  two_names_override_declined: 2_200,
  two_names_override_removed: 2_200,
  two_names_replacement: 2_600,
  two_names_plea: 3_600,
  two_names_ballots_sealing: 2_400,
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
    twoNames: null,
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
    twoNames: snapshot.twoNames
      ? {
          ...snapshot.twoNames,
          initialNomineeIds: snapshot.twoNames.initialNomineeIds
            ? [...snapshot.twoNames.initialNomineeIds]
            : null,
          finalistPlayerIds: snapshot.twoNames.finalistPlayerIds
            ? [...snapshot.twoNames.finalistPlayerIds]
            : null,
          completedMingleWindows: [...snapshot.twoNames.completedMingleWindows],
        }
      : null,
    resolution: snapshot.resolution ? cloneResolution(snapshot.resolution) : null,
    revealedBallots: snapshot.revealedBallots.map((ballot) => ({ ...ballot })),
  };
}

export function cloneResolution(
  resolution: FormatResolutionPresentation,
): FormatResolutionPresentation {
  const aggregate = resolution.aggregate;
  return {
    ...resolution,
    tiedPlayerIds: [...resolution.tiedPlayerIds],
    aggregate: aggregate.capability === "sealed_elim"
      ? {
          capability: aggregate.capability,
          totals: { ...aggregate.totals },
          eligiblePlayerIds: [...aggregate.eligiblePlayerIds],
        }
      : aggregate.capability === "sealed_polarity"
        ? {
            capability: aggregate.capability,
            nets: { ...aggregate.nets },
            savesReceived: { ...aggregate.savesReceived },
            eliminateReceived: { ...aggregate.eliminateReceived },
          }
        : aggregate.capability === "two_names"
          ? {
              capability: aggregate.capability,
              initialNomineeIds: [...aggregate.initialNomineeIds],
              overrideHolderId: aggregate.overrideHolderId,
              overrideAction: aggregate.overrideAction,
              removedNomineeId: aggregate.removedNomineeId,
              replacementNomineeId: aggregate.replacementNomineeId,
              finalistPlayerIds: [...aggregate.finalistPlayerIds],
              eligibleVoterIds: [...aggregate.eligibleVoterIds],
              totals: { ...aggregate.totals },
            }
          : {
              capability: aggregate.capability,
              starterId: aggregate.starterId,
              safePlayerIds: [...aggregate.safePlayerIds],
              vulnerablePlayerIds: [...aggregate.vulnerablePlayerIds],
              voteTotals: { ...aggregate.voteTotals },
            },
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
