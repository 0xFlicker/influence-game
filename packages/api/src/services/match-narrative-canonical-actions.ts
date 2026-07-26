/**
 * Trusted canonical action citations for match narrative.
 *
 * Joins narrative groups to accepted board events via durable decisionId
 * stamped on trusted canonical envelopes (sourcePointers). Never reads raw
 * game_events rows without the validated prefix reader. Never serializes
 * payloads, targets, or source pointers into narrative responses.
 *
 * Eligibility and action vocabulary come from the engine's accepted-action
 * registry so narrative linkage cannot drift from durable reconciliation.
 */

import {
  acceptedActionSourcePointerMatches,
  type CanonicalGameEvent,
} from "@influence/engine";
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

/**
 * Build a minimal decisionId index from a validated trusted event prefix.
 * Only indexes registry-eligible events whose source pointer agrees with the
 * canonical envelope's actor, action, phase, and round.
 *
 * @param events Trusted contiguous prefix only (never untrusted tail).
 * @param pinWhenSet When set, ignore events with sequence > pin (continuation).
 */
export function buildTrustedAcceptedActionIndex(
  events: readonly { sequence: number; eventType: string; envelope: CanonicalGameEvent }[],
  pinWhenSet: number | null = null,
): TrustedCanonicalActionIndex {
  const byDecisionId = new Map<string, TrustedCanonicalActionIndexEntry[]>();
  let lastTrustedSequence = 0;

  for (const row of events) {
    if (row.sequence > lastTrustedSequence) lastTrustedSequence = row.sequence;
    if (pinWhenSet != null && row.sequence > pinWhenSet) continue;
    if (row.eventType !== row.envelope.type) continue;

    for (const entry of extractAcceptedActionEntries(row.envelope)) {
      const list = byDecisionId.get(entry.decisionId) ?? [];
      if (!list.some((candidate) => (
        candidate.eventSequence === entry.eventSequence
        && candidate.eventType === entry.eventType
      ))) {
        list.push(entry);
        byDecisionId.set(entry.decisionId, list);
      }
    }
  }

  // A decision may have one primary direct event. If the same receipt appears
  // on multiple direct sequences, the canonical relationship is ambiguous and
  // must not become a narrative citation.
  for (const [decisionId, entries] of byDecisionId) {
    if (new Set(entries.map((entry) => entry.eventSequence)).size > 1) {
      byDecisionId.delete(decisionId);
    }
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

function extractAcceptedActionEntries(
  envelope: CanonicalGameEvent,
): TrustedCanonicalActionIndexEntry[] {
  const entries: TrustedCanonicalActionIndexEntry[] = [];
  const matches = acceptedActionSourcePointerMatches(envelope);
  for (const { pointer, traceAction } of matches) {
    if (
      typeof pointer.phase !== "string"
      || pointer.phase.length === 0
      || typeof envelope.phase !== "string"
      || pointer.phase !== envelope.phase
      || typeof pointer.round !== "number"
      || !Number.isInteger(pointer.round)
      || typeof envelope.round !== "number"
      || !Number.isInteger(envelope.round)
      || pointer.round !== envelope.round
    ) {
      continue;
    }
    entries.push({
      eventSequence: envelope.sequence,
      eventType: envelope.type,
      decisionId: pointer.decisionId,
      actorPlayerId: pointer.actorId,
      action: traceAction,
      phase: pointer.phase,
      round: pointer.round,
    });
  }

  const uniqueDecisionIds = new Set(entries.map((entry) => entry.decisionId));
  if (
    matches[0]?.registry.cardinality === "one_to_one"
    && uniqueDecisionIds.size > 1
  ) {
    return [];
  }
  return entries;
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
