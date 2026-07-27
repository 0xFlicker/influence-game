import type {
  GameKernel,
  GameWatchReplayFrame,
  ViewerDecisionEvent,
} from "@/lib/api";
import { buildSafetyBouncePresentationCycle } from "@influence/engine/viewer-presentation";
import type {
  FormatPresentationBallot,
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
  FormatPresentationSnapshot,
} from "./types";
import {
  applyResolution,
  appendEmpoweredTallyCue,
  empowerReceipts,
  empowerTallyMatchesReceipts,
  latestSnapshot,
  resolvedEmpoweredMatchesTally,
  safetyBouncePointerDurationMs,
  safetyBouncePointerPacing,
  tiedSetMatchesTally,
  validEmpoweredSetWinner,
} from "./format-presentation-compiler-helpers";
import {
  cloneSnapshot,
  cueKey,
  emptySnapshot,
  FIXED_CUE_DURATION_MS,
  incomplete,
  phaseKey,
} from "./format-presentation-model-helpers";

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
