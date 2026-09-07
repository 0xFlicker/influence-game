import type {
  GameKernel,
  GameWatchReplayFrame,
  ViewerDecisionEvent,
} from "@/lib/api";
import { buildSafetyBouncePresentationCycle } from "@influence/engine/viewer-presentation";
import { formatsAvailableForSelection } from "@influence/engine/format-rules";
import type { LaunchFormatId } from "@influence/engine/format-presentation-metadata";
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
  formatManifest?: readonly LaunchFormatId[];
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
  formatManifest,
  eligiblePlayerIdsByRound,
}: CompileFormatPresentationPrefixInput): FormatPresentationCompilation {
  let snapshot = emptySnapshot();
  const cues: FormatPresentationCue[] = [];
  const rosterIds = roster.map((player) => player.id);
  const ballots = new Map<string, FormatPresentationBallot>();
  const eliminationTargetHistory = new Map<string, Set<string>>();
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
      formatManifest,
      eligiblePlayerIds,
      eligiblePlayerSet: new Set(eligiblePlayerIds),
      ballots,
      eliminationTargetHistory,
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
  formatManifest?: readonly LaunchFormatId[];
  eligiblePlayerIds: readonly string[];
  eligiblePlayerSet: ReadonlySet<string>;
  ballots: Map<string, FormatPresentationBallot>;
  eliminationTargetHistory: Map<string, Set<string>>;
  empower: EmpowerPresentationAccumulator;
  snapshot: FormatPresentationSnapshot;
  cues: FormatPresentationCue[];
}): FormatPresentationCompilation | null {
  const {
    gameId,
    decision,
    formatManifest,
    eligiblePlayerIds,
    eligiblePlayerSet,
    ballots,
    eliminationTargetHistory,
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
        formatManifest
        && !decision.payload.offeredFormatIds.every((formatId) =>
          formatsAvailableForSelection(formatManifest, {
            round: decision.round,
            livingIds: eligiblePlayerIds,
          }).includes(formatId)
        )
      ) {
        return incomplete(
          cues,
          snapshot,
          "invalid_menu",
          decision.sequence,
          "Format menu contains a card unavailable in this round.",
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
      const availableFormats = formatManifest
        ? formatsAvailableForSelection(formatManifest, {
            round: decision.round,
            livingIds: eligiblePlayerIds,
          })
        : [];
      const automaticSelection = !snapshot.offeredFormatIds
        && availableFormats.length === 1
        && availableFormats[0] === decision.payload.formatId;
      if (!snapshot.offeredFormatIds && !automaticSelection) {
        return incomplete(
          cues,
          snapshot,
          "selection_without_menu",
          decision.sequence,
          "Format selection has no trusted offered pair.",
        );
      }
      if (
        snapshot.offeredFormatIds
        && !snapshot.offeredFormatIds.includes(decision.payload.formatId)
      ) {
        return incomplete(
          cues,
          snapshot,
          "selection_not_offered",
          decision.sequence,
          `Selected format ${decision.payload.formatId} was not in the trusted offered pair.`,
        );
      }
      if (
        !eligiblePlayerSet.has(decision.payload.empoweredId)
        || (
          snapshot.empoweredId !== null
          && snapshot.empoweredId !== decision.payload.empoweredId
        )
      ) {
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
        empoweredId: decision.payload.empoweredId,
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
    case "format.two_names_setup": {
      if (
        snapshot.activeFormatId !== "two_names"
        || snapshot.empoweredId !== decision.payload.empoweredId
        || decision.payload.initialNomineeIds[0] === decision.payload.initialNomineeIds[1]
        || decision.payload.initialNomineeIds.includes(decision.payload.empoweredId)
        || !eligiblePlayerSet.has(decision.payload.overrideHolderId)
        || !decision.payload.initialNomineeIds.every((id) => eligiblePlayerSet.has(id))
        || snapshot.twoNames
      ) {
        return incomplete(
          cues,
          snapshot,
          "format_mismatch",
          decision.sequence,
          "Two Names setup does not match the trusted selection and living roster.",
        );
      }
      let cueBefore = cloneSnapshot(snapshot);
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        twoNames: {
          empoweredId: decision.payload.empoweredId,
          initialNomineeIds: null,
          overrideHolderId: null,
          overrideAction: null,
          removedNomineeId: null,
          replacementNomineeId: null,
          finalistPlayerIds: null,
          completedMingleWindows: [],
          pleaCount: 0,
          ballotsSealed: 0,
        },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "two-names-empowered"),
        kind: "two_names_empowered_intro",
        baseDurationMs: FIXED_CUE_DURATION_MS.two_names_empowered_intro,
        empoweredId: decision.payload.empoweredId,
        before: cueBefore,
        after: cloneSnapshot(snapshot),
      });
      cueBefore = cloneSnapshot(snapshot);
      snapshot = {
        ...snapshot,
        twoNames: {
          ...snapshot.twoNames!,
          initialNomineeIds: [...decision.payload.initialNomineeIds],
          finalistPlayerIds: [...decision.payload.initialNomineeIds],
        },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "two-names-nominees"),
        kind: "two_names_initial_names",
        baseDurationMs: FIXED_CUE_DURATION_MS.two_names_initial_names,
        empoweredId: decision.payload.empoweredId,
        nomineeIds: [...decision.payload.initialNomineeIds],
        before: cueBefore,
        after: cloneSnapshot(snapshot),
      });
      cueBefore = cloneSnapshot(snapshot);
      snapshot = {
        ...snapshot,
        twoNames: {
          ...snapshot.twoNames!,
          overrideHolderId: decision.payload.overrideHolderId,
        },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "two-names-override-draw"),
        kind: "two_names_override_draw",
        baseDurationMs: FIXED_CUE_DURATION_MS.two_names_override_draw,
        overrideHolderId: decision.payload.overrideHolderId,
        before: cueBefore,
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.two_names_mingle_completed": {
      const state = snapshot.twoNames;
      const expectedPair = decision.payload.window === "initial_names"
        ? state?.initialNomineeIds
        : state?.finalistPlayerIds;
      if (
        !state
        || !expectedPair
        || state.completedMingleWindows.includes(decision.payload.window)
        || expectedPair.some((id, index) => id !== decision.payload.finalistPlayerIds[index])
      ) {
        return incomplete(cues, snapshot, "format_mismatch", decision.sequence, "Two Names Mingle marker contradicts the trusted pair.");
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        twoNames: {
          ...state,
          completedMingleWindows: [...state.completedMingleWindows, decision.payload.window],
        },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, `two-names-${decision.payload.window}-complete`),
        kind: "two_names_mingle_complete",
        baseDurationMs: FIXED_CUE_DURATION_MS.two_names_mingle_complete,
        window: decision.payload.window,
        finalistPlayerIds: [...decision.payload.finalistPlayerIds],
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.two_names_override_declined": {
      const state = snapshot.twoNames;
      if (
        !state?.initialNomineeIds
        || state.overrideHolderId !== decision.payload.overrideHolderId
        || state.overrideAction
        || state.initialNomineeIds.some((id, index) => id !== decision.payload.finalistPlayerIds[index])
      ) {
        return incomplete(cues, snapshot, "format_mismatch", decision.sequence, "Two Names Override decline contradicts setup.");
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        twoNames: { ...state, overrideAction: "declined", finalistPlayerIds: [...decision.payload.finalistPlayerIds] },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "two-names-override-declined"),
        kind: "two_names_override_declined",
        baseDurationMs: FIXED_CUE_DURATION_MS.two_names_override_declined,
        ...decision.payload,
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.two_names_override_used": {
      const state = snapshot.twoNames;
      if (
        !state?.initialNomineeIds
        || state.overrideHolderId !== decision.payload.overrideHolderId
        || state.overrideAction
        || !state.initialNomineeIds.includes(decision.payload.removedNomineeId)
      ) {
        return incomplete(cues, snapshot, "format_mismatch", decision.sequence, "Two Names Override removal contradicts setup.");
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        twoNames: {
          ...state,
          overrideAction: "used",
          removedNomineeId: decision.payload.removedNomineeId,
          finalistPlayerIds: null,
        },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "two-names-removed"),
        kind: "two_names_override_removed",
        baseDurationMs: FIXED_CUE_DURATION_MS.two_names_override_removed,
        ...decision.payload,
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.two_names_replacement_named": {
      const state = snapshot.twoNames;
      if (
        !state?.initialNomineeIds
        || state.overrideAction !== "used"
        || !state.removedNomineeId
        || state.replacementNomineeId
        || decision.payload.empoweredId !== snapshot.empoweredId
        || state.initialNomineeIds.includes(decision.payload.replacementNomineeId)
      ) {
        return incomplete(cues, snapshot, "format_mismatch", decision.sequence, "Two Names replacement contradicts the removal.");
      }
      const retained = state.initialNomineeIds.find((id) => id !== state.removedNomineeId);
      if (!retained || !decision.payload.finalistPlayerIds.includes(retained) || !decision.payload.finalistPlayerIds.includes(decision.payload.replacementNomineeId)) {
        return incomplete(cues, snapshot, "format_mismatch", decision.sequence, "Two Names replacement does not preserve the retained nominee.");
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        twoNames: {
          ...state,
          replacementNomineeId: decision.payload.replacementNomineeId,
          finalistPlayerIds: [...decision.payload.finalistPlayerIds],
        },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, "two-names-replacement"),
        kind: "two_names_replacement",
        baseDurationMs: FIXED_CUE_DURATION_MS.two_names_replacement,
        ...decision.payload,
        after: cloneSnapshot(snapshot),
      });
      break;
    }
    case "format.two_names_plea_recorded": {
      const state = snapshot.twoNames;
      const expectedSpeaker = state?.finalistPlayerIds?.[state.pleaCount];
      if (!state || state.pleaCount > 1 || decision.payload.ordinal !== state.pleaCount || decision.payload.speakerId !== expectedSpeaker) {
        return incomplete(cues, snapshot, "format_mismatch", decision.sequence, "Two Names plea is out of finalist order.");
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        twoNames: { ...state, pleaCount: state.pleaCount + 1 },
      };
      cues.push({
        ...base,
        key: cueKey(gameId, decision.sequence, `two-names-plea-${decision.payload.ordinal}`),
        kind: "two_names_plea",
        baseDurationMs: Math.max(FIXED_CUE_DURATION_MS.two_names_plea, (decision.payload.text?.length ?? 0) * 45),
        speakerId: decision.payload.speakerId,
        ordinal: decision.payload.ordinal,
        status: decision.payload.status,
        text: decision.payload.text,
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
      if (
        decision.payload.formatId === "restricted_history"
        && (eliminationTargetHistory.get(decision.payload.voterId)?.has(
          decision.payload.targetId,
        ) ?? false)
      ) {
        return incomplete(
          cues,
          snapshot,
          "format_mismatch",
          decision.sequence,
          "Restricted History ballot repeats a prior elimination target.",
        );
      }
      ballots.set(decision.payload.voterId, {
        voterId: decision.payload.voterId,
        targetId: decision.payload.targetId,
        polarity: decision.payload.polarity,
      });
      if (decision.payload.polarity !== "save") {
        const prior = eliminationTargetHistory.get(decision.payload.voterId) ?? new Set<string>();
        prior.add(decision.payload.targetId);
        eliminationTargetHistory.set(decision.payload.voterId, prior);
      }
      snapshot = {
        ...snapshot,
        phase,
        canonicalSequence: decision.sequence,
        twoNames: decision.payload.formatId === "two_names" && snapshot.twoNames
          ? { ...snapshot.twoNames, ballotsSealed: snapshot.twoNames.ballotsSealed + 1 }
          : snapshot.twoNames,
      };
      if (decision.payload.formatId === "two_names" && snapshot.twoNames?.finalistPlayerIds) {
        const eligibleCount = eligiblePlayerIds.filter((id) =>
          id !== snapshot.empoweredId && !snapshot.twoNames!.finalistPlayerIds!.includes(id)
        ).length;
        cues.push({
          ...base,
          key: cueKey(gameId, decision.sequence, "two-names-ballot-sealed"),
          kind: "two_names_ballots_sealing",
          baseDurationMs: FIXED_CUE_DURATION_MS.two_names_ballots_sealing,
          sealedCount: snapshot.twoNames.ballotsSealed,
          eligibleCount,
          after: cloneSnapshot(snapshot),
        });
      }
      break;
    }
    case "format.ballot_forfeited": {
      const voterId = decision.payload.voterId;
      if (
        snapshot.activeFormatId !== "restricted_history"
        || !eligiblePlayerSet.has(voterId)
        || ballots.has(voterId)
      ) {
        return incomplete(
          cues,
          snapshot,
          "format_mismatch",
          decision.sequence,
          "Restricted History ballot forfeiture does not match the active voter state.",
        );
      }
      const prior = eliminationTargetHistory.get(voterId) ?? new Set<string>();
      const legalTargets = eligiblePlayerIds.filter(
        (targetId) => targetId !== voterId && !prior.has(targetId),
      );
      if (legalTargets.length > 0) {
        return incomplete(
          cues,
          snapshot,
          "format_mismatch",
          decision.sequence,
          "Restricted History ballot was forfeited while a legal target remained.",
        );
      }
      ballots.set(voterId, {
        voterId,
        targetId: null,
        polarity: null,
        forfeited: true,
      });
      snapshot = { ...snapshot, phase, canonicalSequence: decision.sequence };
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
