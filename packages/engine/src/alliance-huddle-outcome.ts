/**
 * Official alliance huddle outcome normalization and member-safe projection.
 *
 * Compact limits are applied at creation (and legacy hydration). Participant
 * snapshots authorize protected recall; they never leave server-private surfaces.
 */

import {
  ALLIANCE_HUDDLE_OUTCOME_LIMITS as LIMITS,
  type AllianceHuddleCommitmentFact,
  type AllianceHuddleOutcome,
  type CompactAllianceHuddleOutcome,
  type UUID,
} from "./types";

function clipText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trimEnd();
}

function clipStringList(values: readonly string[], maxItems: number, maxChars: number): string[] {
  return values
    .slice(0, maxItems)
    .map((item) => clipText(item, maxChars))
    .filter(Boolean);
}

function normalizeCommitment(fact: AllianceHuddleCommitmentFact): AllianceHuddleCommitmentFact {
  return {
    speakerId: fact.speakerId,
    speakerName: clipText(fact.speakerName, LIMITS.commitmentFieldChars),
    proposedTargetName: fact.proposedTargetName
      ? clipText(fact.proposedTargetName, LIMITS.commitmentFieldChars)
      : null,
    noTargetReason: fact.noTargetReason
      ? clipText(fact.noTargetReason, LIMITS.commitmentFieldChars)
      : null,
    proposedAction: clipText(fact.proposedAction, LIMITS.commitmentActionChars),
    memberCommitments: fact.memberCommitments
      .slice(0, LIMITS.memberCommitmentItems)
      .map((item) => ({
        memberName: clipText(item.memberName, LIMITS.commitmentFieldChars),
        commitment: clipText(item.commitment, LIMITS.commitmentFieldChars),
      })),
    contingency: clipText(fact.contingency, LIMITS.commitmentFieldChars),
    confidence: fact.confidence,
    dissent: clipStringList(fact.dissent, LIMITS.dissentItems, LIMITS.commitmentFieldChars),
    alternativePlan: fact.alternativePlan
      ? clipText(fact.alternativePlan, LIMITS.commitmentActionChars)
      : null,
  };
}

/**
 * Normalize House summary fields to the fixed compact contract before canonical recording.
 * Does not invent or drop participant authorization.
 */
export function normalizeAllianceHuddleOutcome(
  outcome: AllianceHuddleOutcome,
): AllianceHuddleOutcome {
  const participantPlayerIds = outcome.participantPlayerIds
    ? Array.from(new Set(outcome.participantPlayerIds.filter(Boolean)))
    : undefined;
  return {
    id: outcome.id,
    sessionId: outcome.sessionId,
    allianceId: outcome.allianceId,
    window: outcome.window,
    round: outcome.round,
    ask: clipText(outcome.ask, LIMITS.askChars),
    plan: clipText(outcome.plan, LIMITS.planChars),
    promises: clipStringList(outcome.promises, LIMITS.listItems, LIMITS.listItemChars),
    dissent: clipStringList(outcome.dissent, LIMITS.listItems, LIMITS.listItemChars),
    confidence: outcome.confidence,
    posture: clipText(outcome.posture, LIMITS.postureChars),
    leakOrBetrayalClaims: clipStringList(
      outcome.leakOrBetrayalClaims,
      LIMITS.listItems,
      LIMITS.listItemChars,
    ),
    ...(outcome.commitments
      ? {
          commitments: outcome.commitments
            .slice(0, LIMITS.commitmentItems)
            .map(normalizeCommitment),
        }
      : {}),
    ...(participantPlayerIds && participantPlayerIds.length > 0
      ? { participantPlayerIds }
      : {}),
    createdAt: outcome.createdAt,
  };
}

/**
 * Backfill a legacy outcome's participant snapshot only from the matching
 * completed-session speakerIds. No current-membership fallback.
 */
export function withParticipantSnapshotFromSession(
  outcome: AllianceHuddleOutcome,
  sessionSpeakerIds: readonly UUID[] | null | undefined,
): AllianceHuddleOutcome {
  if (outcome.participantPlayerIds && outcome.participantPlayerIds.length > 0) {
    return normalizeAllianceHuddleOutcome(outcome);
  }
  if (!sessionSpeakerIds || sessionSpeakerIds.length === 0) {
    return normalizeAllianceHuddleOutcome(outcome);
  }
  return normalizeAllianceHuddleOutcome({
    ...outcome,
    participantPlayerIds: [...sessionSpeakerIds],
  });
}

/** True when the outcome has an immutable participant snapshot usable for recall authorization. */
export function hasRecallParticipantSnapshot(outcome: AllianceHuddleOutcome): boolean {
  return Array.isArray(outcome.participantPlayerIds) && outcome.participantPlayerIds.length > 0;
}

/** True when the actor is an authorized session participant on the outcome snapshot. */
export function actorAuthorizedForHuddleOutcome(
  outcome: AllianceHuddleOutcome,
  actorId: UUID,
): boolean {
  return hasRecallParticipantSnapshot(outcome)
    && Boolean(outcome.participantPlayerIds?.includes(actorId));
}

/**
 * Member-safe compact projection: typed summary fields only.
 * Never includes participantPlayerIds.
 */
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
    ask: normalized.ask,
    plan: normalized.plan,
    promises: [...normalized.promises],
    dissent: [...normalized.dissent],
    confidence: normalized.confidence,
    posture: normalized.posture,
    leakOrBetrayalClaims: [...normalized.leakOrBetrayalClaims],
    ...(normalized.commitments
      ? { commitments: normalized.commitments.map((item) => ({ ...item })) }
      : {}),
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
