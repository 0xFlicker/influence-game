import type { PhaseKey, ViewerDecisionEvent } from "@/lib/api";
import {
  applyFormatTiebreak,
  computeSaveOrEliminateNets,
  getFormatRegistration,
  resolveSafetyBounceVote,
} from "@influence/engine/format-rules";
import type { FormatEliminationResolution } from "@influence/engine/format-rules";
import type { FormatPresentationCompilation } from "./format-presentation-model";
import {
  cloneResolution,
  cloneSnapshot,
  cueKey,
  FIXED_CUE_DURATION_MS,
  hasExactKeys,
  incomplete,
  phaseKey,
  sameMembers,
} from "./format-presentation-model-helpers";
import type {
  FormatEmpowerVoteReceipt,
  FormatPresentationBallot,
  FormatPresentationCue,
  FormatPresentationSnapshot,
  FormatResolutionPresentation,
} from "./types";

type EmpowerTallyDecision = Extract<
  ViewerDecisionEvent,
  { type: "vote.empower_tally_resolved" }
>;

interface EmpowerPresentationAccumulator {
  initialVotes: Map<string, string>;
  activeVotes: Map<string, string>;
  revotes: Map<string, string>;
  clearedVotes: Set<string>;
  pendingTally: EmpowerTallyDecision | null;
}

export function applyResolution(input: {
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
    payload.aggregate.capability === "public_chain"
    && (
      payload.aggregate.starterId !== snapshot.safetyBounce?.starterId
      || !sameMembers(
        payload.aggregate.safePlayerIds,
        snapshot.safetyBounce?.safePlayerIds ?? [],
      )
      || !sameMembers(
        payload.aggregate.vulnerablePlayerIds,
        snapshot.safetyBounce?.vulnerablePlayerIds ?? [],
      )
      || (snapshot.safetyBounce?.benchPlayerIds.length ?? 1) !== 0
    )
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
    && payload.aggregate.capability === "public_chain"
    && payload.aggregate.vulnerablePlayerIds.length === 1;
  if (
    automaticSoleVulnerable
    && !validSoleVulnerableResolution(payload, ballots)
  ) {
    return incomplete(
      cues,
      snapshot,
      "aggregate_mismatch",
      decision.sequence,
      "Sole-vulnerable Safety Bounce must resolve without a final ballot.",
    );
  }
  if (!automaticSoleVulnerable && ballots.size !== eligiblePlayerIds.length) {
    return incomplete(
      cues,
      snapshot,
      "incomplete_ballot",
      decision.sequence,
      `Format resolution has ${ballots.size} accepted ballots for ${eligiblePlayerIds.length} eligible agents.`,
    );
  }
  if (
    !automaticSoleVulnerable
    && !aggregatesMatch(payload, ballots, eligiblePlayerIds)
  ) {
    return incomplete(
      cues,
      snapshot,
      "aggregate_mismatch",
      decision.sequence,
      "Format resolution aggregate does not match the accepted ballot prefix.",
    );
  }
  if (!resolutionOutcomeMatchesRules(payload, eligiblePlayerIds, ballots)) {
    return incomplete(
      cues,
      snapshot,
      "aggregate_mismatch",
      decision.sequence,
      "Format resolution outcome does not match the canonical rule math.",
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
    baseDurationMs: FIXED_CUE_DURATION_MS.format_aggregate,
    before,
    after: cloneSnapshot(snapshot),
    resolution: payload,
    ballotPresentationStatus: automaticSoleVulnerable
      ? "not_applicable"
      : "revealed",
  });

  const orderedBallots = automaticSoleVulnerable
    ? []
    : eligiblePlayerIds.flatMap((voterId) => {
    const ballot = ballots.get(voterId);
    return ballot ? [ballot] : [];
    });
  for (const [index, ballot] of orderedBallots.entries()) {
    const pacing = rollCallPacing(index, orderedBallots.length);
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
      baseDurationMs: rollCallDurationMs(pacing),
      before,
      after: cloneSnapshot(snapshot),
      ballot: { ...ballot },
      rollCallIndex: index,
      rollCallCount: orderedBallots.length,
      pacing,
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
      baseDurationMs: FIXED_CUE_DURATION_MS.format_tiebreak,
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
    baseDurationMs: FIXED_CUE_DURATION_MS.format_elimination,
    before,
    after: cloneSnapshot(snapshot),
    eliminatedId: payload.eliminatedId,
    resolutionKind: payload.resolutionKind,
  });
  return null;
}

export function appendEmpoweredTallyCue(input: {
  gameId: string;
  decision: Extract<
    ViewerDecisionEvent,
    { type: "vote.empower_tally_resolved" | "vote.empowered_set" }
  >;
  empoweredId: string;
  counts: Readonly<Record<string, number>>;
  receipts: readonly FormatEmpowerVoteReceipt[];
  snapshot: FormatPresentationSnapshot;
  cues: FormatPresentationCue[];
}): FormatPresentationSnapshot {
  const phase = phaseKey(input.decision.phase);
  const snapshot = {
    ...input.snapshot,
    phase,
    canonicalSequence: input.decision.sequence,
    empoweredId: input.empoweredId,
    empoweredTally: { ...input.counts },
  };
  input.cues.push({
    source: "format",
    key: cueKey(input.gameId, input.decision.sequence, "empowered-tally"),
    canonicalSequence: input.decision.sequence,
    round: input.decision.round,
    phase,
    kind: "empowered_tally",
    baseDurationMs: FIXED_CUE_DURATION_MS.empowered_tally,
    before: cloneSnapshot(input.snapshot),
    after: cloneSnapshot(snapshot),
    empoweredId: input.empoweredId,
    counts: { ...input.counts },
    receipts: input.receipts.map((receipt) => ({ ...receipt })),
  });
  return snapshot;
}

export function empowerReceipts(
  rosterIds: readonly string[],
  empower: EmpowerPresentationAccumulator,
): FormatEmpowerVoteReceipt[] {
  return rosterIds.flatMap((voterId) => {
    const targetId = empower.initialVotes.get(voterId);
    return targetId
      ? [{
          voterId,
          targetId,
          revoteTargetId: empower.revotes.get(voterId) ?? null,
        }]
      : [];
  });
}

export function empowerTallyMatchesReceipts(
  counts: Readonly<Record<string, number>>,
  votes: ReadonlyMap<string, string>,
  eligiblePlayerIds: readonly string[],
  method: EmpowerTallyDecision["payload"]["method"],
): boolean {
  if (!hasExactKeys(counts, eligiblePlayerIds)) return false;
  if (method === "wheel") {
    return votes.size === 0 && Object.values(counts).every((count) => count === 0);
  }
  if (votes.size !== eligiblePlayerIds.length) return false;

  const eligible = new Set(eligiblePlayerIds);
  const expected = Object.fromEntries(eligiblePlayerIds.map((id) => [id, 0]));
  for (const [voterId, targetId] of votes) {
    if (!eligible.has(voterId) || !eligible.has(targetId)) return false;
    expected[targetId] = (expected[targetId] ?? 0) + 1;
  }
  return eligiblePlayerIds.every((id) => counts[id] === expected[id]);
}

export function tiedSetMatchesTally(
  tiedPlayerIds: readonly string[],
  counts: Readonly<Record<string, number>>,
): boolean {
  const highest = Math.max(...Object.values(counts), 0);
  const expected = Object.keys(counts).filter((id) => counts[id] === highest);
  return highest > 0 && sameMembers(tiedPlayerIds, expected);
}

export function resolvedEmpoweredMatchesTally(
  decision: EmpowerTallyDecision,
): boolean {
  if (decision.payload.method === "wheel") {
    return Object.values(decision.payload.counts).every((count) => count === 0);
  }
  const highest = Math.max(...Object.values(decision.payload.counts), 0);
  const leaders = Object.keys(decision.payload.counts).filter(
    (id) => decision.payload.counts[id] === highest,
  );
  return decision.payload.method === "plurality"
    && leaders.length === 1
    && leaders[0] === decision.payload.empowered;
}

export function validEmpoweredSetWinner(
  decision: Extract<ViewerDecisionEvent, { type: "vote.empowered_set" }>,
  pending: EmpowerTallyDecision,
  empower: EmpowerPresentationAccumulator,
): boolean {
  const tied = pending.payload.tied;
  if (!tied?.includes(decision.payload.empowered)) return false;
  if (decision.payload.method === "manual") return true;
  if (decision.payload.method === "initial") return false;

  const expectedRevoters = [...empower.initialVotes.keys()].filter(
    (voterId) => !tied.includes(voterId),
  );
  if (!sameMembers([...empower.revotes.keys()], expectedRevoters)) return false;
  if (!sameMembers([...empower.clearedVotes], expectedRevoters)) return false;
  const revoteCounts = Object.fromEntries(tied.map((id) => [id, 0]));
  for (const targetId of empower.revotes.values()) {
    if (!(targetId in revoteCounts)) return false;
    revoteCounts[targetId] = (revoteCounts[targetId] ?? 0) + 1;
  }
  const highest = Math.max(...Object.values(revoteCounts), 0);
  const finalists = tied.filter((id) => revoteCounts[id] === highest);

  return decision.payload.method === "revote"
    ? finalists.length === 1 && finalists[0] === decision.payload.empowered
    : finalists.includes(decision.payload.empowered);
}

export function latestSnapshot(
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

export function safetyBouncePointerPacing(
  rosterCount: number,
  remainingBeforePointer: number,
): "early" | "middle" | "closing" {
  const pointerIndex = rosterCount - remainingBeforePointer;
  if (remainingBeforePointer <= 2) return "closing";
  if (pointerIndex <= 1) return "early";
  return "middle";
}

export function safetyBouncePointerDurationMs(
  pacing: "early" | "middle" | "closing",
): number {
  if (pacing === "early") return 2_600;
  if (pacing === "middle") return 1_600;
  return 2_900;
}

function rollCallPacing(
  index: number,
  count: number,
): "brisk" | "decisive" | "final" {
  if (index === count - 1) return "final";
  if (index >= Math.max(1, count - 3)) return "decisive";
  return "brisk";
}

function rollCallDurationMs(
  pacing: "brisk" | "decisive" | "final",
): number {
  if (pacing === "brisk") return 800;
  if (pacing === "decisive") return 1_300;
  return 2_000;
}

function validSoleVulnerableResolution(
  resolution: FormatResolutionPresentation,
  ballots: ReadonlyMap<string, FormatPresentationBallot>,
): boolean {
  return validSoleVulnerableResolutionShape(resolution) && ballots.size === 0;
}

function validSoleVulnerableResolutionShape(
  resolution: FormatResolutionPresentation,
): boolean {
  if (resolution.aggregate.capability !== "public_chain") return false;
  const vulnerable = resolution.aggregate.vulnerablePlayerIds;
  return resolution.formatId === "safety_bounce"
    && resolution.resolutionKind === "auto"
    && vulnerable.length === 1
    && resolution.eliminatedId === vulnerable[0]
    && resolution.tiedPlayerIds.length === 0
    && resolution.tiebreakerId === null
    && Object.keys(resolution.aggregate.voteTotals).length === 0;
}

function resolutionOutcomeMatchesRules(
  resolution: FormatResolutionPresentation,
  eligiblePlayerIds: readonly string[],
  ballots: ReadonlyMap<string, FormatPresentationBallot>,
): boolean {
  if (
    !eligiblePlayerIds.includes(resolution.empoweredId)
    || !eligiblePlayerIds.includes(resolution.eliminatedId)
    || (
      resolution.tiebreakerId !== null
      && resolution.tiebreakerId !== resolution.empoweredId
    )
  ) {
    return false;
  }

  const registration = getFormatRegistration(resolution.formatId);

  if (registration.capability === "sealed_polarity") {
    if (resolution.aggregate.capability !== "sealed_polarity") return false;
    const accepted = saveOrEliminateBallots(ballots);
    if (!accepted) return false;
    return outcomeMatchesRuleResolution(
      resolution,
      registration.resolve(eligiblePlayerIds, accepted),
    );
  }

  if (registration.capability === "sealed_elim") {
    if (resolution.aggregate.capability !== "sealed_elim") return false;
    const accepted = unpolarizedBallots(ballots);
    if (!accepted) return false;
    return outcomeMatchesRuleResolution(
      resolution,
      registration.resolve(eligiblePlayerIds, accepted),
    );
  }

  if (resolution.aggregate.capability !== "public_chain") return false;
  const vulnerable = resolution.aggregate.vulnerablePlayerIds;
  if (vulnerable.length === 1) {
    return validSoleVulnerableResolutionShape(resolution);
  }
  return outcomeMatchesRuleResolution(
    resolution,
    resolveSafetyBounceVote(
      vulnerable,
      resolution.aggregate.voteTotals,
    ),
  );
}

function outcomeMatchesRuleResolution(
  resolution: FormatResolutionPresentation,
  expected: FormatEliminationResolution,
): boolean {
  if (expected.kind !== "tie") {
    return resolution.resolutionKind === expected.kind
      && resolution.eliminatedId === expected.eliminatedId
      && resolution.tiebreakerId === null
      && sameMembers(resolution.tiedPlayerIds, expected.tiedSet);
  }
  const broken = applyFormatTiebreak(
    expected.tiedSet,
    resolution.eliminatedId,
  );
  return broken !== null
    && resolution.resolutionKind === broken.kind
    && resolution.tiebreakerId === resolution.empoweredId
    && sameMembers(resolution.tiedPlayerIds, broken.tiedSet);
}

function aggregatesMatch(
  resolution: FormatResolutionPresentation,
  ballots: ReadonlyMap<string, FormatPresentationBallot>,
  rosterIds: readonly string[],
): boolean {
  const registration = getFormatRegistration(resolution.formatId);

  if (registration.capability === "sealed_polarity") {
    if (resolution.aggregate.capability !== "sealed_polarity") return false;
    const aggregate = resolution.aggregate;
    if (
      !hasExactKeys(aggregate.nets, rosterIds)
      || !hasExactKeys(aggregate.savesReceived, rosterIds)
      || !hasExactKeys(aggregate.eliminateReceived, rosterIds)
    ) {
      return false;
    }
    const accepted = saveOrEliminateBallots(ballots);
    if (!accepted) return false;
    const expected = computeSaveOrEliminateNets(rosterIds, accepted);
    return sameCountRecord(aggregate.nets, expected.nets)
      && sameCountRecord(
        aggregate.savesReceived,
        expected.savesReceived,
      )
      && sameCountRecord(
        aggregate.eliminateReceived,
        expected.eliminateReceived,
      );
  }

  if (registration.capability === "sealed_elim") {
    if (resolution.aggregate.capability !== "sealed_elim") return false;
    const aggregate = resolution.aggregate;
    if (!hasExactKeys(aggregate.totals, rosterIds)) return false;
    const accepted = unpolarizedBallots(ballots);
    if (!accepted) return false;
    const expected = registration.score(rosterIds, accepted);
    return sameCountRecord(aggregate.totals, expected.totals)
      && sameMembers(aggregate.eligiblePlayerIds, expected.eligibleIds);
  }

  if (resolution.aggregate.capability !== "public_chain") return false;
  const aggregate = resolution.aggregate;
  const expectedTargetIds = aggregate.vulnerablePlayerIds;
  if (!hasExactKeys(aggregate.voteTotals, expectedTargetIds)) return false;
  const accepted = unpolarizedBallots(ballots);
  if (!accepted) return false;
  const expectedTotals = Object.fromEntries(
    expectedTargetIds.map((playerId) => [playerId, 0]),
  );
  for (const ballot of accepted) {
    if (ballot.targetId in expectedTotals) {
      expectedTotals[ballot.targetId] = (expectedTotals[ballot.targetId] ?? 0) + 1;
    }
  }
  return sameCountRecord(aggregate.voteTotals, expectedTotals);
}

function saveOrEliminateBallots(
  ballots: ReadonlyMap<string, FormatPresentationBallot>,
): Array<{
  voterId: string;
  targetId: string;
  polarity: "save" | "eliminate";
}> | null {
  const accepted = [...ballots.values()].flatMap((ballot) =>
    ballot.polarity === null ? [] : [{
      voterId: ballot.voterId,
      targetId: ballot.targetId,
      polarity: ballot.polarity,
    }]
  );
  return accepted.length === ballots.size ? accepted : null;
}

function unpolarizedBallots(
  ballots: ReadonlyMap<string, FormatPresentationBallot>,
): Array<{ voterId: string; targetId: string }> | null {
  const accepted = [...ballots.values()].flatMap((ballot) =>
    ballot.polarity === null
      ? [{ voterId: ballot.voterId, targetId: ballot.targetId }]
      : []
  );
  return accepted.length === ballots.size ? accepted : null;
}

function sameCountRecord(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  return hasExactKeys(left, Object.keys(right))
    && Object.keys(right).every((id) => left[id] === right[id]);
}
