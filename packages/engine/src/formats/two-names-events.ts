import type {
  CanonicalGameEvent,
  FormatResolutionAggregate,
} from "../canonical-events";
import type { UUID } from "../types";
import {
  computeTwoNamesTallies,
  isLegalTwoNamesInitialPair,
  resolveTwoNames,
  twoNamesOrdinaryVoterIds,
  twoNamesReplacementCandidates,
} from "./two-names";
import type { TwoNamesPair } from "./types";

export type TwoNamesLifecycleStage =
  | "selected"
  | "setup"
  | "initial_mingle_complete"
  | "override_complete"
  | "final_mingle_complete"
  | "pleas_complete"
  | "ballots_complete"
  | "resolved";

export interface TwoNamesRoundProjection {
  round: number;
  stage: TwoNamesLifecycleStage;
  empoweredId: UUID;
  initialNomineeIds: TwoNamesPair | null;
  overrideHolderId: UUID | null;
  overrideAction: "declined" | "used" | null;
  removedNomineeId: UUID | null;
  replacementNomineeId: UUID | null;
  finalistPlayerIds: TwoNamesPair | null;
  completedMingleWindows: Array<"initial_names" | "final_names">;
  pleas: Array<{
    speakerId: UUID;
    ordinal: 0 | 1;
    status: "accepted" | "absent";
    text: string | null;
  }>;
  ballots: Array<{ voterId: UUID; targetId: UUID }>;
  eligibleVoterIds: UUID[];
  totals: Record<UUID, number> | null;
  eliminatedId: UUID | null;
  tiebreakerId: UUID | null;
}

function samePair(left: readonly UUID[], right: readonly UUID[]): boolean {
  return left.length === 2 && left[0] === right[0] && left[1] === right[1];
}

function sameIds(left: readonly UUID[], right: readonly UUID[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameTotals(
  left: Readonly<Record<UUID, number>>,
  right: Readonly<Record<UUID, number>>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((id) => left[id] === right[id]);
}

function aggregateMatchesProjection(
  aggregate: Extract<FormatResolutionAggregate, { capability: "two_names" }>,
  expected: Extract<FormatResolutionAggregate, { capability: "two_names" }>,
): boolean {
  return samePair(aggregate.initialNomineeIds, expected.initialNomineeIds)
    && aggregate.overrideHolderId === expected.overrideHolderId
    && aggregate.overrideAction === expected.overrideAction
    && aggregate.removedNomineeId === expected.removedNomineeId
    && aggregate.replacementNomineeId === expected.replacementNomineeId
    && samePair(aggregate.finalistPlayerIds, expected.finalistPlayerIds)
    && sameIds(aggregate.eligibleVoterIds, expected.eligibleVoterIds)
    && sameTotals(aggregate.totals, expected.totals);
}

function fail(round: number, message: string): never {
  throw new Error(`Invalid Two Names canonical prefix for round ${round}: ${message}`);
}

/**
 * Validate and project one Two Names round from canonical authority only.
 * Valid partial prefixes are returned at their last committed stage.
 */
export function projectTwoNamesRound(
  events: readonly CanonicalGameEvent[],
  round: number,
  livingIdsAtSelection: readonly UUID[],
): TwoNamesRoundProjection | null {
  const selectedEvents = events.filter(
    (event): event is Extract<CanonicalGameEvent, { type: "format.selected" }> =>
      event.round === round
      && event.type === "format.selected"
      && event.payload.formatId === "two_names",
  );
  if (selectedEvents.length === 0) return null;
  if (selectedEvents.length !== 1) fail(round, "requires exactly one Two Names selection");
  const selected = selectedEvents[0]!;
  const relevant = events.filter((event) => event.round === round && (
    event.type.startsWith("format.two_names_")
    || (event.type === "format.ballot_cast" && event.payload.formatId === "two_names")
    || (event.type === "format.resolved" && event.payload.formatId === "two_names")
  ));
  const projection: TwoNamesRoundProjection = {
    round,
    stage: "selected",
    empoweredId: selected.payload.empoweredId,
    initialNomineeIds: null,
    overrideHolderId: null,
    overrideAction: null,
    removedNomineeId: null,
    replacementNomineeId: null,
    finalistPlayerIds: null,
    completedMingleWindows: [],
    pleas: [],
    ballots: [],
    eligibleVoterIds: [],
    totals: null,
    eliminatedId: null,
    tiebreakerId: null,
  };
  let expectingReplacement = false;

  for (const event of relevant) {
    if (expectingReplacement && event.type !== "format.two_names_replacement_named") {
      fail(round, "Override use must be immediately paired with replacement");
    }
    if (event.type === "format.two_names_setup") {
      if (projection.initialNomineeIds) fail(round, "duplicate setup");
      if (event.payload.empoweredId !== projection.empoweredId) fail(round, "setup Empowered mismatch");
      if (!livingIdsAtSelection.includes(event.payload.overrideHolderId)) fail(round, "Override holder was not living at selection");
      if (!isLegalTwoNamesInitialPair(
        event.payload.initialNomineeIds,
        projection.empoweredId,
        livingIdsAtSelection,
      )) fail(round, "illegal initial nominee pair");
      projection.initialNomineeIds = [...event.payload.initialNomineeIds];
      projection.overrideHolderId = event.payload.overrideHolderId;
      projection.stage = "setup";
      continue;
    }
    if (!projection.initialNomineeIds || !projection.overrideHolderId) {
      fail(round, `${event.type} occurred before setup`);
    }
    if (event.type === "format.two_names_mingle_completed") {
      if (projection.completedMingleWindows.includes(event.payload.window)) {
        fail(round, `duplicate ${event.payload.window} Mingle`);
      }
      if (event.payload.window === "initial_names") {
        if (projection.overrideAction) fail(round, "initial Mingle completed after Override");
        if (!samePair(event.payload.finalistPlayerIds, projection.initialNomineeIds)) {
          fail(round, "initial Mingle pair mismatch");
        }
        projection.stage = "initial_mingle_complete";
      } else {
        if (projection.overrideAction !== "used" || !projection.finalistPlayerIds) {
          fail(round, "final Mingle requires used Override and replacement");
        }
        if (!samePair(event.payload.finalistPlayerIds, projection.finalistPlayerIds)) {
          fail(round, "final Mingle pair mismatch");
        }
        projection.stage = "final_mingle_complete";
      }
      projection.completedMingleWindows.push(event.payload.window);
      continue;
    }
    if (!projection.completedMingleWindows.includes("initial_names")) {
      fail(round, `${event.type} occurred before the initial Mingle completed`);
    }
    if (event.type === "format.two_names_override_declined") {
      if (projection.overrideAction) fail(round, "duplicate Override outcome");
      if (event.payload.overrideHolderId !== projection.overrideHolderId) fail(round, "Override holder mismatch");
      if (!samePair(event.payload.finalistPlayerIds, projection.initialNomineeIds)) fail(round, "decline changed the pair");
      projection.overrideAction = "declined";
      projection.finalistPlayerIds = [...projection.initialNomineeIds];
      projection.eligibleVoterIds = twoNamesOrdinaryVoterIds(
        livingIdsAtSelection,
        projection.empoweredId,
        projection.finalistPlayerIds,
      );
      projection.stage = "override_complete";
      continue;
    }
    if (event.type === "format.two_names_override_used") {
      if (projection.overrideAction) fail(round, "duplicate Override outcome");
      if (event.payload.overrideHolderId !== projection.overrideHolderId) fail(round, "Override holder mismatch");
      if (!projection.initialNomineeIds.includes(event.payload.removedNomineeId)) fail(round, "removed player was not nominated");
      projection.overrideAction = "used";
      projection.removedNomineeId = event.payload.removedNomineeId;
      expectingReplacement = true;
      continue;
    }
    if (event.type === "format.two_names_replacement_named") {
      if (!expectingReplacement || projection.overrideAction !== "used" || !projection.removedNomineeId) {
        fail(round, "replacement without a paired Override use");
      }
      if (event.payload.empoweredId !== projection.empoweredId) fail(round, "replacement Empowered mismatch");
      const retained = projection.initialNomineeIds.find((id) => id !== projection.removedNomineeId)!;
      const legal = twoNamesReplacementCandidates({
        livingIds: livingIdsAtSelection,
        empoweredId: projection.empoweredId,
        overrideHolderId: projection.overrideHolderId,
        removedNomineeId: projection.removedNomineeId,
        retainedNomineeId: retained,
      });
      if (!legal.includes(event.payload.replacementNomineeId)) fail(round, "illegal replacement nominee");
      const expectedPair: TwoNamesPair = projection.initialNomineeIds[0] === projection.removedNomineeId
        ? [event.payload.replacementNomineeId, retained]
        : [retained, event.payload.replacementNomineeId];
      if (!samePair(event.payload.finalistPlayerIds, expectedPair)) fail(round, "replacement did not preserve nominee slot order");
      projection.replacementNomineeId = event.payload.replacementNomineeId;
      projection.finalistPlayerIds = expectedPair;
      projection.eligibleVoterIds = twoNamesOrdinaryVoterIds(
        livingIdsAtSelection,
        projection.empoweredId,
        expectedPair,
      );
      projection.stage = "override_complete";
      expectingReplacement = false;
      continue;
    }
    const requiredMingleComplete = projection.overrideAction === "used"
      ? projection.completedMingleWindows.includes("final_names")
      : projection.overrideAction === "declined";
    if (!requiredMingleComplete || !projection.finalistPlayerIds) {
      fail(round, `${event.type} occurred before the final social window completed`);
    }
    if (event.type === "format.two_names_plea_recorded") {
      const expectedOrdinal = projection.pleas.length;
      if (expectedOrdinal > 1 || event.payload.ordinal !== expectedOrdinal) fail(round, "pleas are duplicate or out of order");
      if (event.payload.speakerId !== projection.finalistPlayerIds[expectedOrdinal]) fail(round, "plea speaker does not match finalist order");
      projection.pleas.push({
        speakerId: event.payload.speakerId,
        ordinal: event.payload.ordinal,
        status: event.payload.status,
        text: event.payload.text,
      });
      if (projection.pleas.length === 2) projection.stage = "pleas_complete";
      continue;
    }
    if (projection.pleas.length !== 2) fail(round, `${event.type} occurred before both plea outcomes`);
    if (event.type === "format.ballot_cast") {
      if (!projection.eligibleVoterIds.includes(event.payload.voterId)) fail(round, "ineligible ordinary voter");
      if (!projection.finalistPlayerIds.includes(event.payload.targetId)) fail(round, "ballot target was not a finalist");
      if (projection.ballots.some((ballot) => ballot.voterId === event.payload.voterId)) fail(round, "duplicate ordinary ballot");
      projection.ballots.push({ voterId: event.payload.voterId, targetId: event.payload.targetId });
      if (projection.ballots.length === projection.eligibleVoterIds.length) {
        projection.stage = "ballots_complete";
      }
      continue;
    }
    if (event.type === "format.resolved") {
      if (projection.ballots.length !== projection.eligibleVoterIds.length) fail(round, "resolution before all ordinary ballots");
      if (event.payloadVersion === 1) fail(round, "Two Names cannot use format.resolved v1");
      const aggregate = event.payload.aggregate;
      if (aggregate.capability !== "two_names") fail(round, "resolution capability mismatch");
      const computed = computeTwoNamesTallies(
        projection.finalistPlayerIds,
        projection.eligibleVoterIds,
        projection.ballots,
      );
      const outcome = resolveTwoNames(
        projection.finalistPlayerIds,
        projection.eligibleVoterIds,
        projection.ballots,
      );
      const overrideAction = projection.overrideAction;
      if (!overrideAction) fail(round, "resolution is missing Override outcome");
      const expectedAggregate = {
        capability: "two_names",
        initialNomineeIds: projection.initialNomineeIds,
        overrideHolderId: projection.overrideHolderId,
        overrideAction,
        removedNomineeId: projection.removedNomineeId,
        replacementNomineeId: projection.replacementNomineeId,
        finalistPlayerIds: projection.finalistPlayerIds,
        eligibleVoterIds: projection.eligibleVoterIds,
        totals: computed.totals,
      } satisfies Extract<FormatResolutionAggregate, { capability: "two_names" }>;
      if (!aggregateMatchesProjection(aggregate, expectedAggregate)) {
        fail(round, "terminal aggregate disagrees with accepted prefix");
      }
      if (!projection.finalistPlayerIds.includes(event.payload.eliminatedId)) fail(round, "eliminated player was not a finalist");
      if (outcome.kind === "clear") {
        if (event.payload.eliminatedId !== outcome.eliminatedId || event.payload.tiebreakerId !== null) {
          fail(round, "clear resolution disagrees with tally");
        }
      } else if (event.payload.tiebreakerId !== projection.empoweredId) {
        fail(round, "tied resolution requires Empowered as tiebreaker");
      }
      projection.totals = computed.totals;
      projection.eliminatedId = event.payload.eliminatedId;
      projection.tiebreakerId = event.payload.tiebreakerId;
      projection.stage = "resolved";
    }
  }
  if (expectingReplacement) fail(round, "Override use prefix ended without its atomic replacement");
  return projection;
}

/** Validate every selected Two Names round in a complete or partial game prefix. */
export function validateTwoNamesCanonicalPrefixes(
  events: readonly CanonicalGameEvent[],
): { ok: true; errors: [] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const rounds = new Set(events.flatMap((event) =>
    event.type === "format.selected" && event.payload.formatId === "two_names"
      ? [event.round]
      : []
  ));
  const roster = events.find((event) => event.type === "game.roster_initialized");
  if (rounds.size > 0 && (!roster || roster.type !== "game.roster_initialized")) {
    return { ok: false, errors: ["Two Names prefix has no canonical roster"] };
  }
  for (const round of rounds) {
    const selection = events.find(
      (event) => event.round === round
        && event.type === "format.selected"
        && event.payload.formatId === "two_names",
    );
    if (!selection || !roster || roster.type !== "game.roster_initialized") continue;
    const livingIds = roster.payload.players
      .map((player) => player.id)
      .filter((playerId) => !events.some(
        (event) => event.sequence < selection.sequence
          && event.type === "player.eliminated"
          && event.payload.playerId === playerId,
      ));
    try {
      projectTwoNamesRound(events, round, livingIds);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}
