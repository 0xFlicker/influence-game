/**
 * Trusted canonical action citations for match narrative.
 *
 * Joins narrative groups to accepted board events via durable decisionId
 * stamped on trusted canonical envelopes (sourcePointers). Never reads raw
 * game_events rows without the validated prefix reader. Never serializes
 * payloads, targets, or source pointers into narrative responses.
 *
 * This slice indexes vote.cast only. Other accepted-action types can reuse
 * the same mapping once their writers stamp decisionId.
 */

import type { CanonicalGameEvent, CanonicalSourcePointer } from "@influence/engine";
import type {
  NarrativeGroup,
  NarrativeRelatedActionRef,
} from "./match-narrative-grouping.js";

/** Minimal trusted index entry for one accepted board action. */
export interface TrustedCanonicalActionIndexEntry {
  eventSequence: number;
  eventType: string;
  decisionId: string;
  actorPlayerId: string;
  /** Agent action string from the source pointer (e.g. "vote"). */
  action: string;
  phase: string | null;
  round: number | null;
}

export interface TrustedCanonicalActionIndex {
  /** Exact decisionId → accepted action entries (usually one). */
  byDecisionId: ReadonlyMap<string, readonly TrustedCanonicalActionIndexEntry[]>;
  /** Trusted prefix head sealed for pagination pin (0 when empty). */
  lastTrustedSequence: number;
}

const VOTE_CAST = "vote.cast" as const;

/**
 * Build a minimal decisionId index from a validated trusted event prefix.
 * Only indexes vote.cast envelopes with an exact decisionId on a source
 * pointer and actor/action/phase/round agreement between pointer and envelope.
 *
 * @param events Trusted contiguous prefix only (never untrusted tail).
 * @param pinWhenSet When set, ignore events with sequence > pin (continuation).
 */
export function buildTrustedVoteCastIndex(
  events: readonly { sequence: number; eventType: string; envelope: CanonicalGameEvent }[],
  pinWhenSet: number | null = null,
): TrustedCanonicalActionIndex {
  const byDecisionId = new Map<string, TrustedCanonicalActionIndexEntry[]>();
  let lastTrustedSequence = 0;

  for (const row of events) {
    if (row.sequence > lastTrustedSequence) lastTrustedSequence = row.sequence;
    if (pinWhenSet != null && row.sequence > pinWhenSet) continue;
    if (row.eventType !== VOTE_CAST && row.envelope.type !== VOTE_CAST) continue;

    const entry = extractVoteCastEntry(row.envelope);
    if (!entry) continue;

    const list = byDecisionId.get(entry.decisionId) ?? [];
    list.push(entry);
    byDecisionId.set(entry.decisionId, list);
  }

  return { byDecisionId, lastTrustedSequence };
}

/**
 * Attach trusted relatedActionRefs to groups that already contain authorized
 * cognition. Dialogue-only groups never unlock citations. Mutates group copies
 * (does not mutate input array elements in place when they lack cognition).
 */
export function attachTrustedRelatedActionRefs(
  groups: readonly NarrativeGroup[],
  index: TrustedCanonicalActionIndex | null,
): NarrativeGroup[] {
  if (!index || index.byDecisionId.size === 0) {
    return groups.map((g) => stripRelatedActionRefs(g));
  }

  return groups.map((group) => {
    const refs = resolveTrustedRefsForGroup(group, index);
    if (!refs || refs.length === 0) {
      return stripRelatedActionRefs(group);
    }
    return { ...group, relatedActionRefs: refs };
  });
}

function stripRelatedActionRefs(group: NarrativeGroup): NarrativeGroup {
  if (!group.relatedActionRefs) return group;
  const { relatedActionRefs: _drop, ...rest } = group;
  return rest;
}

/**
 * Resolve trusted citations for one group. Requires at least one cognition
 * member (thinking or strategy). Matches exact decisionId with actor, action,
 * phase, and round agreement against cognition members.
 */
export function resolveTrustedRefsForGroup(
  group: NarrativeGroup,
  index: TrustedCanonicalActionIndex,
): NarrativeRelatedActionRef[] | undefined {
  const cognitionMembers = group.members.filter(
    (m) => m.kind === "thinking" || m.kind === "strategy",
  );
  if (cognitionMembers.length === 0) return undefined;

  const seen = new Set<number>();
  const refs: NarrativeRelatedActionRef[] = [];

  const groupActorId = group.actor.playerId;
  for (const member of cognitionMembers) {
    const decisionId = member.decisionId ?? group.decisionId;
    if (!decisionId) continue;

    const candidates = index.byDecisionId.get(decisionId);
    if (!candidates || candidates.length === 0) continue;

    for (const candidate of candidates) {
      if (seen.has(candidate.eventSequence)) continue;
      // Group actor is the only seat identity on group members after encoding.
      if (!actorAgrees(groupActorId, candidate.actorPlayerId)) continue;
      if (!actionAgrees(member.action ?? group.action, candidate.action)) continue;
      if (!phaseAgrees(member.phase ?? group.phase, candidate.phase)) continue;
      if (!roundAgrees(member.round ?? group.round, candidate.round)) continue;

      seen.add(candidate.eventSequence);
      refs.push({
        eventSequence: candidate.eventSequence,
        eventType: candidate.eventType,
        phase: candidate.phase,
        round: candidate.round,
        action: candidate.action,
      });
    }
  }

  if (refs.length === 0) return undefined;
  refs.sort((a, b) => a.eventSequence - b.eventSequence);
  return refs;
}

function extractVoteCastEntry(
  envelope: CanonicalGameEvent,
): TrustedCanonicalActionIndexEntry | null {
  if (envelope.type !== VOTE_CAST) return null;

  const payload = envelope.payload;
  if (!payload || typeof payload !== "object") return null;
  const voterId = (payload as { voterId?: unknown }).voterId;
  if (typeof voterId !== "string" || voterId.length === 0) return null;

  const pointers = envelope.sourcePointers;
  if (!Array.isArray(pointers) || pointers.length === 0) return null;

  for (const pointer of pointers) {
    const extracted = entryFromPointer(envelope, voterId, pointer);
    if (extracted) return extracted;
  }
  return null;
}

function entryFromPointer(
  envelope: CanonicalGameEvent,
  voterId: string,
  pointer: CanonicalSourcePointer | Record<string, unknown>,
): TrustedCanonicalActionIndexEntry | null {
  if (!pointer || typeof pointer !== "object") return null;
  const decisionId = "decisionId" in pointer ? pointer.decisionId : undefined;
  if (typeof decisionId !== "string" || decisionId.length === 0) return null;

  const pointerActor = "actorId" in pointer ? pointer.actorId : undefined;
  const actorPlayerId =
    typeof pointerActor === "string" && pointerActor.length > 0 ? pointerActor : voterId;
  // Require pointer actor (when present) to agree with envelope voter.
  if (typeof pointerActor === "string" && pointerActor.length > 0 && pointerActor !== voterId) {
    return null;
  }

  const pointerAction = "action" in pointer ? pointer.action : undefined;
  if (typeof pointerAction !== "string" || pointerAction.length === 0) return null;
  // This slice only links vote.cast ↔ agent action "vote".
  if (pointerAction !== "vote") return null;

  const pointerPhase = "phase" in pointer ? pointer.phase : undefined;
  const envelopePhase = envelope.phase;
  const phase =
    typeof pointerPhase === "string" && pointerPhase.length > 0
      ? pointerPhase
      : typeof envelopePhase === "string"
        ? envelopePhase
        : null;
  if (
    typeof pointerPhase === "string"
    && typeof envelopePhase === "string"
    && pointerPhase !== envelopePhase
  ) {
    return null;
  }

  const pointerRound = "round" in pointer ? pointer.round : undefined;
  const envelopeRound = envelope.round;
  const round =
    typeof pointerRound === "number" && Number.isInteger(pointerRound)
      ? pointerRound
      : typeof envelopeRound === "number" && Number.isInteger(envelopeRound)
        ? envelopeRound
        : null;
  if (
    typeof pointerRound === "number"
    && typeof envelopeRound === "number"
    && pointerRound !== envelopeRound
  ) {
    return null;
  }

  return {
    eventSequence: envelope.sequence,
    eventType: VOTE_CAST,
    decisionId,
    actorPlayerId,
    action: pointerAction,
    phase,
    round,
  };
}

function actorAgrees(memberActor: string | null | undefined, candidateActor: string): boolean {
  if (!memberActor || memberActor.length === 0) return false;
  return memberActor === candidateActor;
}

function actionAgrees(
  memberAction: string | null | undefined,
  candidateAction: string,
): boolean {
  if (!memberAction || memberAction.length === 0) return false;
  return memberAction === candidateAction;
}

function phaseAgrees(
  memberPhase: string | null | undefined,
  candidatePhase: string | null,
): boolean {
  if (memberPhase == null || memberPhase.length === 0) return false;
  if (candidatePhase == null || candidatePhase.length === 0) return false;
  return memberPhase === candidatePhase;
}

function roundAgrees(
  memberRound: number | null | undefined,
  candidateRound: number | null,
): boolean {
  if (memberRound == null || !Number.isInteger(memberRound)) return false;
  if (candidateRound == null || !Number.isInteger(candidateRound)) return false;
  return memberRound === candidateRound;
}
