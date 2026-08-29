/**
 * Canonical alliance-huddle outcomes contain only engine/session metadata and
 * accepted member-authored fact atoms. House interpretation and dialogue are
 * presentation artifacts and never enter this module's factual projection.
 */

import type {
  AllianceHuddleFactAtom,
  AllianceHuddleOutcome,
  AllianceHuddleWindow,
  CompactAllianceHuddleOutcome,
  UUID,
} from "./types";

/** Safe metadata retained when replaying a historical prose-backed v1 event. */
export interface LegacyAllianceHuddleOutcomeV1Metadata {
  id: UUID;
  sessionId: UUID;
  allianceId: UUID;
  window: AllianceHuddleWindow;
  round: number;
  participantPlayerIds?: UUID[];
  createdAt: string;
}

function uniqueIds(ids: readonly UUID[] | null | undefined): UUID[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

/** Clone the exact v2 contract without inspecting any presentation prose. */
export function normalizeAllianceHuddleOutcome(
  outcome: AllianceHuddleOutcome,
): AllianceHuddleOutcome {
  return {
    id: outcome.id,
    sessionId: outcome.sessionId,
    allianceId: outcome.allianceId,
    window: outcome.window,
    round: outcome.round,
    facts: structuredClone(outcome.facts),
    participantPlayerIds: uniqueIds(outcome.participantPlayerIds),
    createdAt: outcome.createdAt,
  };
}

/**
 * Historical v1 is fail-closed: preserve only safe session metadata and the
 * private participant snapshot, and expose no factual claims from old prose.
 */
export function decodeLegacyAllianceHuddleOutcomeV1(
  outcome: LegacyAllianceHuddleOutcomeV1Metadata,
  sessionSpeakerIds: readonly UUID[] | null | undefined,
): AllianceHuddleOutcome {
  const participantPlayerIds = uniqueIds(
    outcome.participantPlayerIds && outcome.participantPlayerIds.length > 0
      ? outcome.participantPlayerIds
      : sessionSpeakerIds,
  );
  return {
    id: outcome.id,
    sessionId: outcome.sessionId,
    allianceId: outcome.allianceId,
    window: outcome.window,
    round: outcome.round,
    facts: [],
    participantPlayerIds,
    createdAt: outcome.createdAt,
  };
}

/**
 * Backfill a missing/empty participant snapshot only from the matching
 * completed-session speaker IDs. No current-membership fallback is legal.
 */
export function withParticipantSnapshotFromSession(
  outcome: AllianceHuddleOutcome,
  sessionSpeakerIds: readonly UUID[] | null | undefined,
): AllianceHuddleOutcome {
  if (outcome.participantPlayerIds.length > 0) {
    return normalizeAllianceHuddleOutcome(outcome);
  }
  return normalizeAllianceHuddleOutcome({
    ...outcome,
    participantPlayerIds: uniqueIds(sessionSpeakerIds),
  });
}

/** True when the outcome has an immutable participant snapshot usable for recall authorization. */
export function hasRecallParticipantSnapshot(outcome: AllianceHuddleOutcome): boolean {
  return outcome.participantPlayerIds.length > 0;
}

/** True when the actor is an authorized session participant on the outcome snapshot. */
export function actorAuthorizedForHuddleOutcome(
  outcome: AllianceHuddleOutcome,
  actorId: UUID,
): boolean {
  return outcome.participantPlayerIds.includes(actorId);
}

/** Member-safe official projection. Participant authorization IDs never leave the server-private outcome. */
export function toCompactAllianceHuddleOutcome(
  outcome: AllianceHuddleOutcome,
): CompactAllianceHuddleOutcome {
  const normalized = normalizeAllianceHuddleOutcome(outcome);
  return {
    id: normalized.id,
    sessionId: normalized.sessionId,
    allianceId: normalized.allianceId,
    window: normalized.window,
    round: normalized.round,
    facts: structuredClone(normalized.facts),
    createdAt: normalized.createdAt,
  };
}

/** Compact outcomes authorized for the actor by participant snapshot only. */
export function authorizedCompactHuddleOutcomesForActor(
  outcomes: readonly AllianceHuddleOutcome[],
  actorId: UUID,
): CompactAllianceHuddleOutcome[] {
  return outcomes
    .filter((outcome) => actorAuthorizedForHuddleOutcome(outcome, actorId))
    .map(toCompactAllianceHuddleOutcome);
}

export type AllianceHuddlePlayerName = (playerId: UUID) => string;

function tacticalActionLabel(
  actionKind: "empower_vote" | "council_vote" | "format_ballot" | "format_pointer",
): string {
  switch (actionKind) {
    case "empower_vote": return "empower vote";
    case "council_vote": return "Council vote";
    case "format_ballot": return "format ballot";
    case "format_pointer": return "format pointer";
  }
}

function tacticalActionWithArticle(
  actionKind: "empower_vote" | "council_vote" | "format_ballot" | "format_pointer",
): string {
  const label = tacticalActionLabel(actionKind);
  return `${actionKind === "empower_vote" ? "an" : "a"} ${label}`;
}

function conditionLabel(
  fact: Extract<AllianceHuddleFactAtom, { kind: "contingency" }>,
  playerName: AllianceHuddlePlayerName,
): string {
  switch (fact.conditionKind) {
    case "target_ineligible":
      return fact.conditionPlayerId
        ? `${playerName(fact.conditionPlayerId)} becomes ineligible`
        : "the target becomes ineligible";
    case "vote_count_changed":
      return "the vote count changes";
    case "format_action_changed":
      return "the format action changes";
    case "ally_response_changed":
      return fact.conditionPlayerId
        ? `${playerName(fact.conditionPlayerId)} changes response`
        : "an ally changes response";
  }
}

/** Deterministic viewer/prompt text rendered exclusively from typed atoms and canonical player IDs. */
export function formatAllianceHuddleFact(
  fact: AllianceHuddleFactAtom,
  playerName: AllianceHuddlePlayerName,
): string {
  const actor = playerName(fact.actorPlayerId);
  switch (fact.kind) {
    case "proposal":
      return `${actor} proposed ${tacticalActionWithArticle(fact.actionKind)} for ${playerName(fact.targetPlayerId)} (${fact.confidence} confidence).`;
    case "commitment":
      return `${actor} recorded a commitment to ${tacticalActionWithArticle(fact.actionKind)} for ${playerName(fact.targetPlayerId)} (${fact.confidence} confidence).`;
    case "response": {
      const replacement = fact.stance === "counter"
        ? ` with ${tacticalActionLabel(fact.replacementActionKind!)} for ${playerName(fact.replacementTargetPlayerId!)}`
        : "";
      const responseVerb = fact.stance === "endorse"
        ? "endorsed"
        : fact.stance === "reject"
          ? "rejected"
          : "countered";
      return `${actor} ${responseVerb} fact ${fact.counterpartFactId}${replacement} (${fact.confidence} confidence).`;
    }
    case "contingency":
      return `${actor} recorded a contingency: if ${conditionLabel(fact, playerName)}, use ${tacticalActionWithArticle(fact.effectActionKind)} for ${playerName(fact.effectTargetPlayerId)} (${fact.confidence} confidence).`;
  }
}

/** Honest deterministic state for modern empty outcomes and fail-closed v1 replay. */
export function formatAllianceHuddleFacts(
  facts: readonly AllianceHuddleFactAtom[],
  playerName: AllianceHuddlePlayerName,
): string[] {
  if (facts.length === 0) return ["No structured huddle facts were recorded."];
  return facts.map((fact) => formatAllianceHuddleFact(fact, playerName));
}
