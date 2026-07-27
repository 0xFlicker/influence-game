import type {
  GameKernel,
  GameWatchReplayFrame,
  PhaseKey,
  ViewerDecisionEvent,
} from "@/lib/api";
import {
  applyFormatTiebreak,
  computeSaveOrEliminateNets,
  computeVoteBombTallies,
  resolveSafetyBounceVote,
  resolveSaveOrEliminate,
  resolveVoteBomb,
} from "@influence/engine/format-rules";
import { buildSafetyBouncePresentationCycle } from "@influence/engine/viewer-presentation";
import type {
  FormatEmpowerVoteReceipt,
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
  | "invalid_empower_receipt"
  | "empower_tally_mismatch"
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
  | "safety_bounce_classification_mismatch"
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

const FIXED_CUE_DURATION_MS = {
  empowered_tally: 2_400,
  format_menu: 3_000,
  format_selected: 3_600,
  safety_bounce_started: 2_400,
  format_aggregate: 3_200,
  format_tiebreak: 2_400,
  format_elimination: 3_200,
} satisfies Partial<Record<FormatPresentationCue["kind"], number>>;

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
  const empower: EmpowerPresentationAccumulator = {
    initialVotes: new Map(),
    activeVotes: new Map(),
    revotes: new Map(),
    clearedVotes: new Set(),
    pendingTally: null,
  };
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
      empower.initialVotes.clear();
      empower.activeVotes.clear();
      empower.revotes.clear();
      empower.clearedVotes.clear();
      empower.pendingTally = null;
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
      empower,
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
  empower: EmpowerPresentationAccumulator;
  snapshot: FormatPresentationSnapshot;
  cues: FormatPresentationCue[];
}): FormatPresentationCompilation | null {
  const {
    gameId,
    decision,
    eligiblePlayerIds,
    eligiblePlayerSet,
    ballots,
    empower,
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
    case "vote.cast": {
      if (
        !eligiblePlayerSet.has(decision.payload.voterId)
        || !eligiblePlayerSet.has(decision.payload.empowerTarget)
        || empower.initialVotes.has(decision.payload.voterId)
      ) {
        return incomplete(
          cues,
          snapshot,
          "invalid_empower_receipt",
          decision.sequence,
          "Empower receipt must name one eligible voter and one eligible target.",
        );
      }
      empower.initialVotes.set(
        decision.payload.voterId,
        decision.payload.empowerTarget,
      );
      empower.activeVotes.set(
        decision.payload.voterId,
        decision.payload.empowerTarget,
      );
      break;
    }
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
      if (
        !empowerTallyMatchesReceipts(
          decision.payload.counts,
          empower.activeVotes,
          eligiblePlayerIds,
          decision.payload.method,
        )
      ) {
        return incomplete(
          cues,
          snapshot,
          "empower_tally_mismatch",
          decision.sequence,
          "Empowered aggregate does not match the accepted vote receipts.",
        );
      }
      if (decision.payload.method === "tie_pending") {
        if (
          !decision.payload.tied
          || decision.payload.tied.length < 2
          || !decision.payload.tied.every((id) => eligiblePlayerSet.has(id))
          || !tiedSetMatchesTally(
            decision.payload.tied,
            decision.payload.counts,
          )
        ) {
          return incomplete(
            cues,
            snapshot,
            "empower_tally_mismatch",
            decision.sequence,
            "Pending Empowered tally must name at least two eligible tied agents.",
          );
        }
        empower.pendingTally = decision;
        break;
      }
      if (decision.payload.tied !== null) {
        return incomplete(
          cues,
          snapshot,
          "empower_tally_mismatch",
          decision.sequence,
          "Resolved Empowered tally cannot retain a pending tied set.",
        );
      }
      if (!resolvedEmpoweredMatchesTally(decision)) {
        return incomplete(
          cues,
          snapshot,
          "empower_tally_mismatch",
          decision.sequence,
          "Resolved Empowered agent does not match the trusted aggregate.",
        );
      }
      snapshot = appendEmpoweredTallyCue({
        gameId,
        decision,
        empoweredId: decision.payload.empowered,
        counts: decision.payload.counts,
        receipts: empowerReceipts(eligiblePlayerIds, empower),
        snapshot,
        cues,
      });
      break;
    }
    case "vote.empower_vote_cleared": {
      if (
        !empower.pendingTally
        || !eligiblePlayerSet.has(decision.payload.voterId)
        || empower.pendingTally.payload.tied?.includes(decision.payload.voterId)
        || empower.clearedVotes.has(decision.payload.voterId)
        || !empower.activeVotes.delete(decision.payload.voterId)
      ) {
        return incomplete(
          cues,
          snapshot,
          "invalid_empower_receipt",
          decision.sequence,
          "Empower vote clear does not match a pending accepted vote.",
        );
      }
      empower.clearedVotes.add(decision.payload.voterId);
      break;
    }
    case "vote.empower_revote_cast": {
      const tied = empower.pendingTally?.payload.tied;
      if (
        !tied
        || !eligiblePlayerSet.has(decision.payload.voterId)
        || !tied.includes(decision.payload.target)
        || !empower.clearedVotes.has(decision.payload.voterId)
        || empower.revotes.has(decision.payload.voterId)
      ) {
        return incomplete(
          cues,
          snapshot,
          "invalid_empower_receipt",
          decision.sequence,
          "Empower revote must name one eligible voter and a pending tied target.",
        );
      }
      empower.activeVotes.set(decision.payload.voterId, decision.payload.target);
      empower.revotes.set(decision.payload.voterId, decision.payload.target);
      break;
    }
    case "vote.empowered_set": {
      const pending = empower.pendingTally;
      if (!pending) break;
      if (!validEmpoweredSetWinner(decision, pending, empower)) {
        return incomplete(
          cues,
          snapshot,
          "empower_tally_mismatch",
          decision.sequence,
          "Final Empowered agent does not match the accepted revote state.",
        );
      }
      snapshot = appendEmpoweredTallyCue({
        gameId,
        decision,
        empoweredId: decision.payload.empowered,
        counts: pending.payload.counts,
        receipts: empowerReceipts(eligiblePlayerIds, empower),
        snapshot,
        cues,
      });
      empower.pendingTally = null;
      break;
    }
    case "format.menu_offered": {
      const [first, second] = decision.payload.offeredFormatIds;
      if (empower.pendingTally) {
        return incomplete(
          cues,
          snapshot,
          "empowered_mismatch",
          decision.sequence,
          "Format menu opened before the pending Empowered tie was resolved.",
        );
      }
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
        baseDurationMs: FIXED_CUE_DURATION_MS.format_menu,
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
      const selectedCueBase = {
        ...base,
        kind: "format_selected",
        empoweredId: decision.payload.empoweredId,
        formatId: decision.payload.formatId,
        after: cloneSnapshot(snapshot),
      } as const;
      cues.push({
        ...selectedCueBase,
        key: cueKey(gameId, decision.sequence, "selected-choice"),
        stage: "choice_legible",
        baseDurationMs: FIXED_CUE_DURATION_MS.format_selected / 2,
      });
      cues.push({
        ...selectedCueBase,
        key: cueKey(gameId, decision.sequence, "selected-rules"),
        stage: "rules_reveal",
        baseDurationMs: FIXED_CUE_DURATION_MS.format_selected / 2,
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
      if (
        decision.payload.formatId === "safety_bounce"
        && (
          !snapshot.safetyBounce
          || snapshot.safetyBounce.benchPlayerIds.length > 0
          || !snapshot.safetyBounce.vulnerablePlayerIds.includes(
            decision.payload.targetId,
          )
        )
      ) {
        return incomplete(
          cues,
          snapshot,
          "unknown_player",
          decision.sequence,
          "Safety Bounce ballot target must belong to the final Vulnerable pool.",
        );
      }
      if (
        (decision.payload.formatId === "save_or_eliminate"
          && decision.payload.polarity === null)
        || (decision.payload.formatId !== "save_or_eliminate"
          && decision.payload.polarity !== null)
        || (
          decision.payload.formatId !== "safety_bounce"
          && decision.payload.voterId === decision.payload.targetId
        )
      ) {
        return incomplete(
          cues,
          snapshot,
          "format_mismatch",
          decision.sequence,
          "Format ballot polarity or target is not legal for the selected format.",
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
        baseDurationMs: FIXED_CUE_DURATION_MS.safety_bounce_started,
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
      const expectedClassification = board.safePlayerIds.includes(
        decision.payload.actorId,
      )
        ? "vulnerable"
        : "safe";
      if (decision.payload.classification !== expectedClassification) {
        return incomplete(
          cues,
          snapshot,
          "safety_bounce_classification_mismatch",
          decision.sequence,
          `Safety Bounce actor ${decision.payload.actorId} must classify the target as ${expectedClassification}.`,
        );
      }
      const pointerCandidateIds = buildSafetyBouncePresentationCycle({
        gameId,
        round: decision.round,
        canonicalSequence: decision.sequence,
        rosterPlayerIds: eligiblePlayerIds,
        eligibleCandidateIds: board.benchPlayerIds,
        acceptedTargetId: decision.payload.targetId,
      });
      const pacing = safetyBouncePointerPacing(
        eligiblePlayerIds.length,
        board.benchPlayerIds.length,
      );
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
        baseDurationMs: safetyBouncePointerDurationMs(pacing),
        ...decision.payload,
        pointerCandidateIds,
        pacing,
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
    && (
      payload.safetyBounce.starterId !== snapshot.safetyBounce?.starterId
      || !sameMembers(
        payload.safetyBounce.safePlayerIds,
        snapshot.safetyBounce?.safePlayerIds ?? [],
      )
      || !sameMembers(
        payload.safetyBounce.vulnerablePlayerIds,
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
    && payload.safetyBounce?.vulnerablePlayerIds.length === 1;
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

function appendEmpoweredTallyCue(input: {
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

function empowerReceipts(
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

function empowerTallyMatchesReceipts(
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

function tiedSetMatchesTally(
  tiedPlayerIds: readonly string[],
  counts: Readonly<Record<string, number>>,
): boolean {
  const highest = Math.max(...Object.values(counts), 0);
  const expected = Object.keys(counts).filter((id) => counts[id] === highest);
  return highest > 0 && sameMembers(tiedPlayerIds, expected);
}

function resolvedEmpoweredMatchesTally(
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

function validEmpoweredSetWinner(
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

function safetyBouncePointerPacing(
  rosterCount: number,
  remainingBeforePointer: number,
): "early" | "middle" | "closing" {
  const pointerIndex = rosterCount - remainingBeforePointer;
  if (remainingBeforePointer <= 2) return "closing";
  if (pointerIndex <= 1) return "early";
  return "middle";
}

function safetyBouncePointerDurationMs(
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
  const vulnerable = resolution.safetyBounce?.vulnerablePlayerIds ?? [];
  return resolution.formatId === "safety_bounce"
    && resolution.resolutionKind === "auto"
    && resolution.saveOrEliminate === null
    && resolution.voteBomb === null
    && vulnerable.length === 1
    && resolution.eliminatedId === vulnerable[0]
    && resolution.tiedPlayerIds.length === 0
    && resolution.tiebreakerId === null
    && Object.keys(resolution.safetyBounce?.voteTotals ?? {}).length === 0;
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

  if (resolution.formatId === "save_or_eliminate") {
    if (
      !resolution.saveOrEliminate
      || resolution.voteBomb
      || resolution.safetyBounce
    ) {
      return false;
    }
    const accepted = saveOrEliminateBallots(ballots);
    if (!accepted) return false;
    return outcomeMatchesRuleResolution(
      resolution,
      resolveSaveOrEliminate(eligiblePlayerIds, accepted),
    );
  }

  if (resolution.formatId === "vote_bomb") {
    if (
      resolution.saveOrEliminate
      || !resolution.voteBomb
      || resolution.safetyBounce
    ) {
      return false;
    }
    const accepted = unpolarizedBallots(ballots);
    if (!accepted) return false;
    return outcomeMatchesRuleResolution(
      resolution,
      resolveVoteBomb(eligiblePlayerIds, accepted),
    );
  }

  if (
    resolution.saveOrEliminate
    || resolution.voteBomb
    || !resolution.safetyBounce
  ) {
    return false;
  }
  const vulnerable = resolution.safetyBounce.vulnerablePlayerIds;
  if (vulnerable.length === 1) {
    return validSoleVulnerableResolutionShape(resolution);
  }
  return outcomeMatchesRuleResolution(
    resolution,
    resolveSafetyBounceVote(
      vulnerable,
      resolution.safetyBounce.voteTotals,
    ),
  );
}

function outcomeMatchesRuleResolution(
  resolution: FormatResolutionPresentation,
  expected: ReturnType<
    | typeof resolveSaveOrEliminate
    | typeof resolveVoteBomb
    | typeof resolveSafetyBounceVote
  >,
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
  if (resolution.saveOrEliminate) {
    if (
      !hasExactKeys(resolution.saveOrEliminate.nets, rosterIds)
      || !hasExactKeys(resolution.saveOrEliminate.savesReceived, rosterIds)
      || !hasExactKeys(resolution.saveOrEliminate.eliminateReceived, rosterIds)
    ) {
      return false;
    }
    const accepted = saveOrEliminateBallots(ballots);
    if (!accepted) return false;
    const expected = computeSaveOrEliminateNets(rosterIds, accepted);
    return sameCountRecord(resolution.saveOrEliminate.nets, expected.nets)
      && sameCountRecord(
        resolution.saveOrEliminate.savesReceived,
        expected.savesReceived,
      )
      && sameCountRecord(
        resolution.saveOrEliminate.eliminateReceived,
        expected.eliminateReceived,
      );
  }
  const totals = resolution.voteBomb?.totals ?? resolution.safetyBounce?.voteTotals;
  if (!totals) return false;
  const expectedTargetIds = resolution.voteBomb
    ? rosterIds
    : resolution.safetyBounce?.vulnerablePlayerIds ?? [];
  if (!hasExactKeys(totals, expectedTargetIds)) return false;
  const accepted = unpolarizedBallots(ballots);
  if (!accepted) return false;
  const expected = computeVoteBombTallies(expectedTargetIds, accepted);
  return sameCountRecord(totals, expected.totals)
    && (
      !resolution.voteBomb
      || sameMembers(
        resolution.voteBomb.zeroSafePlayerIds,
        expected.zeroSafeIds,
      )
    );
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
