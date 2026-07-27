import type {
  GameKernel,
  GameWatchReplayFrame,
  PhaseKey,
  ViewerDecisionEvent,
} from "@/lib/api";
import type {
  FormatPresentationBallot,
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
  FormatPresentationSnapshot,
  FormatResolutionPresentation,
} from "./types";

export type FormatPresentationDiagnosticCode =
  | "duplicate_sequence"
  | "unknown_player"
  | "invalid_menu"
  | "empowered_mismatch"
  | "selection_without_menu"
  | "selection_not_offered"
  | "format_mismatch"
  | "duplicate_ballot"
  | "incomplete_ballot"
  | "aggregate_mismatch"
  | "safety_bounce_missing_start"
  | "safety_bounce_duplicate_start"
  | "safety_bounce_invalid_actor"
  | "safety_bounce_duplicate_target"
  | "safety_bounce_resolution_mismatch";

export interface FormatPresentationDiagnostic {
  code: FormatPresentationDiagnosticCode;
  sequence: number;
  message: string;
}

export interface FormatPresentationCompilation {
  status: "ready" | "incomplete";
  cues: FormatPresentationCue[];
  snapshot: FormatPresentationSnapshot;
  diagnostic: FormatPresentationDiagnostic | null;
}

export interface CompileFormatPresentationPrefixInput {
  gameId: string;
  gameKernel: GameKernel;
  roster: readonly FormatPresentationRosterPlayer[];
  decisions: readonly ViewerDecisionEvent[];
  eligiblePlayerIdsByRound?: ReadonlyMap<number, readonly string[]>;
}

const CUE_DURATION_MS: Record<FormatPresentationCue["kind"], number> = {
  empowered_tally: 2_400,
  format_menu: 3_000,
  format_selected: 3_600,
  safety_bounce_started: 2_400,
  safety_bounce_pointer: 2_200,
  format_aggregate: 3_200,
  format_roll_call: 1_200,
  format_tiebreak: 2_400,
  format_elimination: 3_200,
};

export function formatPresentationDecisionsFromFrames(
  frames: readonly GameWatchReplayFrame[],
): ViewerDecisionEvent[] {
  return frames
    .filter((frame) => frame.viewerDecisionEvent)
    .sort((left, right) => left.sequence - right.sequence)
    .map((frame) => frame.viewerDecisionEvent!);
}

export function formatPresentationEligibilityFromFrames(
  frames: readonly GameWatchReplayFrame[],
): ReadonlyMap<number, readonly string[]> {
  const eligiblePlayerIdsByRound = new Map<number, readonly string[]>();
  for (const frame of [...frames].sort((left, right) => left.sequence - right.sequence)) {
    if (eligiblePlayerIdsByRound.has(frame.round)) continue;
    eligiblePlayerIdsByRound.set(
      frame.round,
      frame.players
        .filter((player) => player.status === "alive")
        .map((player) => player.id),
    );
  }
  return eligiblePlayerIdsByRound;
}

export function compileFormatPresentationPrefix({
  gameId,
  gameKernel,
  roster,
  decisions,
  eligiblePlayerIdsByRound,
}: CompileFormatPresentationPrefixInput): FormatPresentationCompilation {
  let snapshot = emptySnapshot();
  const cues: FormatPresentationCue[] = [];
  const rosterIds = roster.map((player) => player.id);
  const ballots = new Map<string, FormatPresentationBallot>();
  const seenSequences = new Map<number, string>();

  if (gameKernel !== "format") {
    return { status: "ready", cues, snapshot, diagnostic: null };
  }

  const ordered = [...decisions].sort((left, right) => left.sequence - right.sequence);
  for (const decision of ordered) {
    const fingerprint = JSON.stringify(decision);
    const existingFingerprint = seenSequences.get(decision.sequence);
    if (existingFingerprint) {
      if (existingFingerprint === fingerprint) continue;
      return incomplete(
        cues,
        snapshot,
        "duplicate_sequence",
        decision.sequence,
        `Canonical sequence ${decision.sequence} contains contradictory viewer decisions.`,
      );
    }
    seenSequences.set(decision.sequence, fingerprint);

    if (decision.round > snapshot.round) {
      snapshot = emptySnapshot(decision.round, phaseKey(decision.phase));
      ballots.clear();
    } else if (decision.round < snapshot.round) {
      continue;
    }

    const eligiblePlayerIds = eligiblePlayerIdsByRound?.has(decision.round)
      ? rosterIds.filter((id) => eligiblePlayerIdsByRound.get(decision.round)?.includes(id))
      : rosterIds;
    const failure = applyDecision({
      gameId,
      decision,
      eligiblePlayerIds,
      eligiblePlayerSet: new Set(eligiblePlayerIds),
      ballots,
      snapshot,
      cues,
    });
    if (failure) return failure;
    snapshot = latestSnapshot(snapshot, cues, decision.sequence, phaseKey(decision.phase));
  }

  return {
    status: "ready",
    cues,
    snapshot: cloneSnapshot(snapshot),
    diagnostic: null,
  };
}

function applyDecision(input: {
  gameId: string;
  decision: ViewerDecisionEvent;
  eligiblePlayerIds: readonly string[];
  eligiblePlayerSet: ReadonlySet<string>;
  ballots: Map<string, FormatPresentationBallot>;
  snapshot: FormatPresentationSnapshot;
  cues: FormatPresentationCue[];
}): FormatPresentationCompilation | null {
  const {
    gameId,
    decision,
    eligiblePlayerIds,
    eligiblePlayerSet,
    ballots,
    cues,
  } = input;
  let { snapshot } = input;
  const before = cloneSnapshot(snapshot);
  const phase = phaseKey(decision.phase);
  const base = {
    source: "format" as const,
    canonicalSequence: decision.sequence,
    round: decision.round,
    phase,
    before,
  };

  switch (decision.type) {
    case "vote.empower_tally_resolved": {
      if (!eligiblePlayerSet.has(decision.payload.empowered)) {
        return incomplete(
          cues,
          snapshot,
          "unknown_player",
          decision.sequence,
          `Empowered agent ${decision.payload.empowered} is not eligible this round.`,
        );
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        empoweredId: decision.payload.empowered,
        empoweredTally: { ...decision.payload.counts },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "empowered-tally"),
        kind: "empowered_tally",
        baseDurationMs: CUE_DURATION_MS.empowered_tally,
        empoweredId: decision.payload.empowered,
        counts: { ...decision.payload.counts },
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.menu_offered": {
      const [first, second] = decision.payload.offeredFormatIds;
      if (
        !eligiblePlayerSet.has(decision.payload.empoweredId)
        || first === second
      ) {
        return incomplete(
          cues,
          snapshot,
          !eligiblePlayerSet.has(decision.payload.empoweredId) ? "unknown_player" : "invalid_menu",
          decision.sequence,
          "Format menu must name an eligible empowered agent and two distinct formats.",
        );
      }
      if (
        snapshot.empoweredId
        && snapshot.empoweredId !== decision.payload.empoweredId
      ) {
        return incomplete(
          cues,
          snapshot,
          "empowered_mismatch",
          decision.sequence,
          "Format menu empowered agent does not match the trusted tally.",
        );
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        empoweredId: decision.payload.empoweredId,
        offeredFormatIds: [...decision.payload.offeredFormatIds],
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "menu"),
        kind: "format_menu",
        baseDurationMs: CUE_DURATION_MS.format_menu,
        empoweredId: decision.payload.empoweredId,
        offeredFormatIds: [...decision.payload.offeredFormatIds],
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.selected": {
      if (!snapshot.offeredFormatIds) {
        return incomplete(
          cues,
          snapshot,
          "selection_without_menu",
          decision.sequence,
          "Format selection has no trusted offered pair.",
        );
      }
      if (!snapshot.offeredFormatIds.includes(decision.payload.formatId)) {
        return incomplete(
          cues,
          snapshot,
          "selection_not_offered",
          decision.sequence,
          `Selected format ${decision.payload.formatId} was not in the trusted offered pair.`,
        );
      }
      if (snapshot.empoweredId !== decision.payload.empoweredId) {
        return incomplete(
          cues,
          snapshot,
          "unknown_player",
          decision.sequence,
          "Format selection does not match the trusted empowered agent.",
        );
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        activeFormatId: decision.payload.formatId,
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "selected"),
        kind: "format_selected",
        baseDurationMs: CUE_DURATION_MS.format_selected,
        empoweredId: decision.payload.empoweredId,
        formatId: decision.payload.formatId,
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.ballot_cast": {
      const invalidPlayer = !eligiblePlayerSet.has(decision.payload.voterId)
        ? decision.payload.voterId
        : !eligiblePlayerSet.has(decision.payload.targetId)
          ? decision.payload.targetId
          : null;
      if (invalidPlayer) {
        return incomplete(
          cues,
          snapshot,
          "unknown_player",
          decision.sequence,
          `Format ballot player ${invalidPlayer} is not eligible this round.`,
        );
      }
      if (snapshot.activeFormatId !== decision.payload.formatId) {
        return incomplete(
          cues,
          snapshot,
          "format_mismatch",
          decision.sequence,
          "Format ballot does not match the selected format.",
        );
      }
      if (ballots.has(decision.payload.voterId)) {
        return incomplete(
          cues,
          snapshot,
          "duplicate_ballot",
          decision.sequence,
          `Agent ${decision.payload.voterId} has more than one accepted format ballot.`,
        );
      }
      ballots.set(decision.payload.voterId, {
        voterId: decision.payload.voterId,
        targetId: decision.payload.targetId,
        polarity: decision.payload.polarity,
      });
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
      };
      break;
    }
    case "format.safety_bounce_started": {
      if (snapshot.activeFormatId !== "safety_bounce") {
        return incomplete(
          cues,
          snapshot,
          "format_mismatch",
          decision.sequence,
          "Safety Bounce started without a trusted Safety Bounce selection.",
        );
      }
      if (snapshot.safetyBounce) {
        return incomplete(
          cues,
          snapshot,
          "safety_bounce_duplicate_start",
          decision.sequence,
          "Safety Bounce started more than once in the round.",
        );
      }
      if (!eligiblePlayerSet.has(decision.payload.starterId)) {
        return incomplete(
          cues,
          snapshot,
          "unknown_player",
          decision.sequence,
          `Safety Bounce starter ${decision.payload.starterId} is not eligible this round.`,
        );
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        safetyBounce: {
          starterId: decision.payload.starterId,
          currentActorId: decision.payload.starterId,
          safePlayerIds: [decision.payload.starterId],
          vulnerablePlayerIds: [],
          benchPlayerIds: eligiblePlayerIds.filter(
            (id) => id !== decision.payload.starterId,
          ),
        },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "bounce-started"),
        kind: "safety_bounce_started",
        baseDurationMs: CUE_DURATION_MS.safety_bounce_started,
        starterId: decision.payload.starterId,
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.safety_bounce_pointer": {
      const board = snapshot.safetyBounce;
      if (!board) {
        return incomplete(
          cues,
          snapshot,
          "safety_bounce_missing_start",
          decision.sequence,
          "Safety Bounce pointer has no trusted starter.",
        );
      }
      if (board.currentActorId !== decision.payload.actorId) {
        return incomplete(
          cues,
          snapshot,
          "safety_bounce_invalid_actor",
          decision.sequence,
          `Expected ${board.currentActorId} to act, received ${decision.payload.actorId}.`,
        );
      }
      if (!board.benchPlayerIds.includes(decision.payload.targetId)) {
        return incomplete(
          cues,
          snapshot,
          "safety_bounce_duplicate_target",
          decision.sequence,
          `Safety Bounce target ${decision.payload.targetId} is already classified or unknown.`,
        );
      }
      const safePlayerIds = [...board.safePlayerIds];
      const vulnerablePlayerIds = [...board.vulnerablePlayerIds];
      if (decision.payload.classification === "safe") {
        safePlayerIds.push(decision.payload.targetId);
      } else {
        vulnerablePlayerIds.push(decision.payload.targetId);
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        safetyBounce: {
          ...board,
          currentActorId: decision.payload.targetId,
          safePlayerIds,
          vulnerablePlayerIds,
          benchPlayerIds: board.benchPlayerIds.filter(
            (id) => id !== decision.payload.targetId,
          ),
        },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "bounce-pointer"),
        kind: "safety_bounce_pointer",
        baseDurationMs: CUE_DURATION_MS.safety_bounce_pointer,
        ...decision.payload,
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.resolved":
      return applyResolution({
        gameId,
        decision,
        eligiblePlayerIds,
        ballots,
        snapshot,
        cues,
      });
    default:
      break;
  }

  input.snapshot = snapshot;
  return null;
}

function applyResolution(input: {
  gameId: string;
  decision: Extract<ViewerDecisionEvent, { type: "format.resolved" }>;
  eligiblePlayerIds: readonly string[];
  ballots: ReadonlyMap<string, FormatPresentationBallot>;
  snapshot: FormatPresentationSnapshot;
  cues: FormatPresentationCue[];
}): FormatPresentationCompilation | null {
  const { gameId, decision, eligiblePlayerIds, ballots, cues } = input;
  let { snapshot } = input;
  const phase = phaseKey(decision.phase);
  const payload = cloneResolution(decision.payload);

  if (
    snapshot.activeFormatId !== payload.formatId
    || snapshot.empoweredId !== payload.empoweredId
  ) {
    return incomplete(
      cues,
      snapshot,
      "format_mismatch",
      decision.sequence,
      "Format resolution does not match the trusted selection.",
    );
  }
  if (
    payload.safetyBounce
    && !sameMembers(payload.safetyBounce.safePlayerIds, snapshot.safetyBounce?.safePlayerIds ?? [])
      || payload.safetyBounce
      && !sameMembers(
        payload.safetyBounce.vulnerablePlayerIds,
        snapshot.safetyBounce?.vulnerablePlayerIds ?? [],
      )
      || payload.safetyBounce
      && (snapshot.safetyBounce?.benchPlayerIds.length ?? 1) !== 0
  ) {
    return incomplete(
      cues,
      snapshot,
      "safety_bounce_resolution_mismatch",
      decision.sequence,
      "Safety Bounce aggregate does not match the accepted classification prefix.",
    );
  }

  const automaticSoleVulnerable =
    payload.formatId === "safety_bounce"
    && payload.resolutionKind === "auto"
    && payload.safetyBounce?.vulnerablePlayerIds.length === 1;
  if (!automaticSoleVulnerable && ballots.size !== eligiblePlayerIds.length) {
    return incomplete(
      cues,
      snapshot,
      "incomplete_ballot",
      decision.sequence,
      `Format resolution has ${ballots.size} accepted ballots for ${eligiblePlayerIds.length} eligible agents.`,
    );
  }
  if (!aggregatesMatch(payload, ballots, eligiblePlayerIds)) {
    return incomplete(
      cues,
      snapshot,
      "aggregate_mismatch",
      decision.sequence,
      "Format resolution aggregate does not match the accepted ballot prefix.",
    );
  }

  let before = cloneSnapshot(snapshot);
  snapshot = {
    ...snapshot,
    phase,
    canonicalSequence: decision.sequence,
    resolution: payload,
  };
  cues.push({
    source: "format",
    key: cueKey(gameId, decision.sequence, "aggregate"),
    canonicalSequence: decision.sequence,
    round: decision.round,
    phase,
    kind: "format_aggregate",
    baseDurationMs: CUE_DURATION_MS.format_aggregate,
    before,
    after: cloneSnapshot(snapshot),
    resolution: payload,
  });

  const orderedBallots = eligiblePlayerIds.flatMap((voterId) => {
    const ballot = ballots.get(voterId);
    return ballot ? [ballot] : [];
  });
  for (const [index, ballot] of orderedBallots.entries()) {
    before = cloneSnapshot(snapshot);
    snapshot = {
      ...snapshot,
      revealedBallots: [...snapshot.revealedBallots, { ...ballot }],
    };
    cues.push({
      source: "format",
      key: cueKey(gameId, decision.sequence, `roll-call-${index}`),
      canonicalSequence: decision.sequence,
      round: decision.round,
      phase,
      kind: "format_roll_call",
      baseDurationMs: CUE_DURATION_MS.format_roll_call,
      before,
      after: cloneSnapshot(snapshot),
      ballot: { ...ballot },
      rollCallIndex: index,
      rollCallCount: orderedBallots.length,
    });
  }

  if (payload.tiebreakerId) {
    before = cloneSnapshot(snapshot);
    cues.push({
      source: "format",
      key: cueKey(gameId, decision.sequence, "tiebreak"),
      canonicalSequence: decision.sequence,
      round: decision.round,
      phase,
      kind: "format_tiebreak",
      baseDurationMs: CUE_DURATION_MS.format_tiebreak,
      before,
      after: cloneSnapshot(snapshot),
      tiebreakerId: payload.tiebreakerId,
      tiedPlayerIds: [...payload.tiedPlayerIds],
    });
  }

  before = cloneSnapshot(snapshot);
  snapshot = {
    ...snapshot,
    eliminatedId: payload.eliminatedId,
  };
  cues.push({
    source: "format",
    key: cueKey(gameId, decision.sequence, "elimination"),
    canonicalSequence: decision.sequence,
    round: decision.round,
    phase,
    kind: "format_elimination",
    baseDurationMs: CUE_DURATION_MS.format_elimination,
    before,
    after: cloneSnapshot(snapshot),
    eliminatedId: payload.eliminatedId,
    resolutionKind: payload.resolutionKind,
  });
  input.snapshot = snapshot;
  return null;
}

function latestSnapshot(
  fallback: FormatPresentationSnapshot,
  cues: readonly FormatPresentationCue[],
  sequence: number,
  phase: PhaseKey,
): FormatPresentationSnapshot {
  const latest = cues.at(-1);
  if (latest?.canonicalSequence === sequence) return cloneSnapshot(latest.after);
  if (fallback.canonicalSequence === sequence) return cloneSnapshot(fallback);
  return {
    ...cloneSnapshot(fallback),
    canonicalSequence: sequence,
    phase,
  };
}

function aggregatesMatch(
  resolution: FormatResolutionPresentation,
  ballots: ReadonlyMap<string, FormatPresentationBallot>,
  rosterIds: readonly string[],
): boolean {
  if (resolution.saveOrEliminate) {
    if (
      !hasExactKeys(resolution.saveOrEliminate.nets, rosterIds)
      || !hasExactKeys(resolution.saveOrEliminate.savesReceived, rosterIds)
      || !hasExactKeys(resolution.saveOrEliminate.eliminateReceived, rosterIds)
    ) {
      return false;
    }
    const saves: Record<string, number> = {};
    const eliminates: Record<string, number> = {};
    for (const ballot of ballots.values()) {
      if (ballot.polarity === "save") {
        saves[ballot.targetId] = (saves[ballot.targetId] ?? 0) + 1;
      } else if (ballot.polarity === "eliminate") {
        eliminates[ballot.targetId] = (eliminates[ballot.targetId] ?? 0) + 1;
      } else {
        return false;
      }
    }
    return Object.keys(resolution.saveOrEliminate.nets).every((id) =>
      (resolution.saveOrEliminate?.savesReceived[id] ?? 0) === (saves[id] ?? 0)
      && (resolution.saveOrEliminate?.eliminateReceived[id] ?? 0) === (eliminates[id] ?? 0)
      && (resolution.saveOrEliminate?.nets[id] ?? 0) === (saves[id] ?? 0) - (eliminates[id] ?? 0)
    );
  }
  const totals = resolution.voteBomb?.totals ?? resolution.safetyBounce?.voteTotals;
  if (!totals) return false;
  const expectedTargetIds = resolution.voteBomb
    ? rosterIds
    : resolution.safetyBounce?.vulnerablePlayerIds ?? [];
  if (!hasExactKeys(totals, expectedTargetIds)) return false;
  const actual: Record<string, number> = {};
  for (const ballot of ballots.values()) {
    if (ballot.polarity !== null) return false;
    actual[ballot.targetId] = (actual[ballot.targetId] ?? 0) + 1;
  }
  return Object.keys(totals).every((id) => totals[id] === (actual[id] ?? 0))
    && Object.keys(actual).every((id) => id in totals);
}

function incomplete(
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

function cueKey(gameId: string, sequence: number, suffix: string): string {
  return `${gameId}:${sequence}:${suffix}`;
}

function emptySnapshot(round = 0, phase: PhaseKey = "INIT"): FormatPresentationSnapshot {
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

function cloneSnapshot(snapshot: FormatPresentationSnapshot): FormatPresentationSnapshot {
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

function cloneResolution(
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

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(record);
  return sameMembers(actualKeys, expectedKeys);
}

function phaseKey(phase: ViewerDecisionEvent["phase"]): PhaseKey {
  return (phase ?? "INIT") as PhaseKey;
}
