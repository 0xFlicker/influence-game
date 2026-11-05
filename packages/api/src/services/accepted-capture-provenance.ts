import { sha256StableJson } from "./stable-hash.js";
import { and, eq, inArray } from "drizzle-orm";
import { acceptedActionSourcePointerMatches, providerAcceptedDecisionId } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { loadPayloads } from "./payload-storage.js";
import type { AcceptedActionDecisionRef } from "./accepted-action-correlation.js";

export function captureProvenanceKey(ref: Pick<AcceptedActionDecisionRef, "gameId" | "eventSequence" | "decisionId">): string {
  return `${ref.gameId}:${ref.eventSequence}:${ref.decisionId}`;
}

/** Resolve original capture owners only through terminal accepted journal facts. */
export async function acceptedCaptureProvenance(db: Pick<DrizzleDB, "select">, refs: readonly AcceptedActionDecisionRef[], crossEpochOnly = false) {
  const result = new Map<string, { ownerEpoch: string; attemptId: string }>();
  if (!refs.length) return result;
  const gameIds = [...new Set(refs.map(ref => ref.gameId))];
  const attempts = await db.select({
    gameId: schema.providerLogicalCalls.gameId,
    sequence: schema.providerLogicalCalls.canonicalEventSequence,
    turnId: schema.providerLogicalCalls.gameTurnId,
    committedAt: schema.providerLogicalCalls.gameTurnCommittedAt,
    attemptId: schema.providerCallAttempts.id,
    ownerEpoch: schema.providerCallAttempts.ownerEpoch,
  }).from(schema.providerLogicalCalls).innerJoin(schema.providerCallAttempts, and(
    eq(schema.providerCallAttempts.id, schema.providerLogicalCalls.acceptedAttemptId),
    eq(schema.providerCallAttempts.logicalCallId, schema.providerLogicalCalls.id),
    eq(schema.providerCallAttempts.gameId, schema.providerLogicalCalls.gameId),
  )).where(and(
    inArray(schema.providerLogicalCalls.gameId, gameIds),
    eq(schema.providerCallAttempts.authorityKind, "game"),
    eq(schema.providerCallAttempts.status, "terminal"),
    eq(schema.providerCallAttempts.disposition, "accepted"),
    eq(schema.providerCallAttempts.outcomeKind, "usable"),
  ));
  const byDecision = new Map(attempts.map(attempt => [`${attempt.gameId}:${providerAcceptedDecisionId(attempt.attemptId)}`, attempt]));
  const turnIds = [...new Set(refs.flatMap(ref => {
    const attempt = byDecision.get(`${ref.gameId}:${ref.decisionId}`);
    if (crossEpochOnly && attempt?.ownerEpoch === ref.ownerEpoch) return [];
    return attempt?.sequence == null && attempt?.turnId && attempt.committedAt ? [attempt.turnId] : [];
  }))];
  const turns = turnIds.length ? await loadPayloads(db.select({
    id: schema.gameTurns.id, gameId: schema.gameTurns.gameId,
    ownerEpoch: schema.gameTurns.committedOwnerEpoch, committedAt: schema.gameTurns.committedAt,
    commitResult: schema.gameTurns.commitResult,
  }).from(schema.gameTurns).where(and(inArray(schema.gameTurns.id, turnIds), inArray(schema.gameTurns.gameId, gameIds), eq(schema.gameTurns.status, "committed")))) : [];
  const turnsById = new Map(turns.map(turn => [turn.id, turn]));
  for (const ref of refs) {
    if (ref.canonicalConflict) continue;
    const attempt = byDecision.get(`${ref.gameId}:${ref.decisionId}`);
    if (!attempt || (crossEpochOnly && attempt.ownerEpoch === ref.ownerEpoch)) continue;
    let bound = attempt.sequence === ref.eventSequence;
    // Atomic durable turns bind provider calls to their commit, rather than
    // filling the older per-call canonical_event_sequence column.
    if (attempt.sequence === null && attempt.turnId && attempt.committedAt) {
      const turn = turnsById.get(attempt.turnId);
      bound = Boolean(turn && turn.gameId === ref.gameId && turn.ownerEpoch === ref.ownerEpoch
        && turn.committedAt === attempt.committedAt && turn.commitResult?.gameId === ref.gameId
        && turn.commitResult.turnId === turn.id
        && turn.commitResult.canonicalEvents.some(({ sequence, event, eventHash }) => sequence === ref.eventSequence
          && eventHash === ref.canonicalEventHash && sha256StableJson(event) === eventHash
          && event.sequence === sequence && event.gameId === ref.gameId
          && acceptedActionSourcePointerMatches(event).some(({ pointer, traceAction }) => pointer.decisionId === ref.decisionId && traceAction === ref.traceAction)));
    }
    if (bound) result.set(captureProvenanceKey(ref), { ownerEpoch: attempt.ownerEpoch, attemptId: attempt.attemptId });
  }
  return result;
}
