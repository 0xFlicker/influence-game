import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import {
  acceptedActionSourcePointerMatches,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { TrustedPersistedGameEvent } from "./game-event-read-model.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { rebuildPromptReuseRollupInTransaction } from "./prompt-reuse-accounting.js";
import { PRIVATE_TRACE_EVIDENCE_TYPE } from "./private-trace-writer.js";

type CorrelationReadDB = Pick<DrizzleDB, "select">;

export interface AcceptedActionDecisionRef {
  gameId: string;
  ownerEpoch: string;
  decisionId: string;
  eventSequence: number;
  traceAction: string;
  canonicalConflict: boolean;
}

export type AcceptedActionCorrelationDiagnostic =
  | {
      code: "accepted_action_private_capture_missing";
      decisionId: string;
      eventSequence: number;
      missing: Array<"manifest" | "cognition">;
    }
  | {
      code: "accepted_action_correlation_conflict";
      decisionId: string;
      eventSequence: number;
      conflictingSequences: number[];
    }
  | {
      code: "accepted_action_trace_action_mismatch";
      decisionId: string;
      eventSequence: number;
      expectedAction: string;
      mismatchedSources: Array<"manifest" | "cognition">;
    };

export interface AcceptedActionCorrelationSummary {
  eligibleDecisionCount: number;
  linkedDecisionCount: number;
  unresolvedDecisionCount: number;
  missingCaptureDecisionCount: number;
  conflictDecisionCount: number;
}

export interface AcceptedActionCorrelationResult extends AcceptedActionCorrelationSummary {
  updatedManifestCount: number;
  updatedCognitiveArtifactCount: number;
  updatedPromptReuseSourceCount: number;
  diagnostics: AcceptedActionCorrelationDiagnostic[];
}

export type NonfatalAcceptedActionCorrelationResult =
  | { ok: true; result: AcceptedActionCorrelationResult }
  | { ok: false; error: string };

interface CorrelationRows {
  manifests: Array<typeof schema.gameEvidenceManifests.$inferSelect>;
  cognition: Array<typeof schema.gameCognitiveArtifacts.$inferSelect>;
  promptReuseSources: Array<typeof schema.gamePromptReuseAppliedSources.$inferSelect>;
}

interface CorrelationRowStatus {
  actionMismatch: boolean;
  actionMismatchSources: Array<"manifest" | "cognition">;
  conflictSequences: number[];
  missing: Array<"manifest" | "cognition">;
  unresolved: boolean;
  linked: boolean;
}

export function acceptedActionDecisionRefs(
  persistedEvents: readonly TrustedPersistedGameEvent[],
  ownerEpoch?: string,
): AcceptedActionDecisionRef[] {
  const refs = new Map<string, AcceptedActionDecisionRef>();

  for (const persisted of persistedEvents) {
    if (ownerEpoch && persisted.ownerEpoch !== ownerEpoch) continue;
    const matches = acceptedActionSourcePointerMatches(persisted.envelope);
    if (matches.length === 0) continue;

    const uniqueDecisionIds = [...new Set(
      matches.map(({ pointer }) => pointer.decisionId),
    )];
    const oneToOneConflict = matches[0]!.registry.cardinality === "one_to_one"
      && uniqueDecisionIds.length > 1;

    for (const decisionId of uniqueDecisionIds) {
      const key = `${persisted.ownerEpoch}:${decisionId}`;
      const traceActions = new Set(
        matches
          .filter(({ pointer }) => pointer.decisionId === decisionId)
          .map(({ traceAction }) => traceAction),
      );
      const traceAction = [...traceActions][0]!;
      const existing = refs.get(key);
      if (existing && existing.eventSequence !== persisted.sequence) {
        existing.canonicalConflict = true;
        continue;
      }
      if (existing && existing.traceAction !== traceAction) {
        existing.canonicalConflict = true;
        continue;
      }
      refs.set(key, {
        gameId: persisted.gameId,
        ownerEpoch: persisted.ownerEpoch,
        decisionId,
        eventSequence: persisted.sequence,
        traceAction,
        canonicalConflict: oneToOneConflict || traceActions.size > 1,
      });
    }
  }

  return [...refs.values()].sort((left, right) => (
    left.eventSequence - right.eventSequence
    || left.decisionId.localeCompare(right.decisionId)
  ));
}

function correlationRefKey(ref: Pick<
  AcceptedActionDecisionRef,
  "gameId" | "ownerEpoch" | "decisionId"
>): string {
  return `${ref.gameId}\u0000${ref.ownerEpoch}\u0000${ref.decisionId}`;
}

function cognitionRefKey(ref: Pick<
  AcceptedActionDecisionRef,
  "gameId" | "decisionId"
>): string {
  return `${ref.gameId}\u0000${ref.decisionId}`;
}

function addGroupedRow<T>(map: Map<string, T[]>, key: string, row: T): void {
  const rows = map.get(key) ?? [];
  rows.push(row);
  map.set(key, rows);
}

async function loadCorrelationRowsByRef(
  db: CorrelationReadDB,
  refs: readonly AcceptedActionDecisionRef[],
): Promise<Map<string, CorrelationRows>> {
  if (refs.length === 0) return new Map();
  const gameIds = [...new Set(refs.map((ref) => ref.gameId))];
  const decisionIds = [...new Set(refs.map((ref) => ref.decisionId))];
  const [manifests, cognition, promptReuseSources] = await Promise.all([
    db.select()
      .from(schema.gameEvidenceManifests)
      .where(and(
        inArray(schema.gameEvidenceManifests.gameId, gameIds),
        inArray(schema.gameEvidenceManifests.decisionId, decisionIds),
        eq(schema.gameEvidenceManifests.evidenceType, PRIVATE_TRACE_EVIDENCE_TYPE),
      )),
    db.select()
      .from(schema.gameCognitiveArtifacts)
      .where(and(
        inArray(schema.gameCognitiveArtifacts.gameId, gameIds),
        inArray(schema.gameCognitiveArtifacts.decisionId, decisionIds),
      )),
    db.select()
      .from(schema.gamePromptReuseAppliedSources)
      .where(and(
        inArray(schema.gamePromptReuseAppliedSources.gameId, gameIds),
        inArray(schema.gamePromptReuseAppliedSources.decisionId, decisionIds),
      )),
  ]);

  const manifestsByRef = new Map<string, typeof manifests>();
  const cognitionByRef = new Map<string, typeof cognition>();
  const promptReuseByRef = new Map<string, typeof promptReuseSources>();
  for (const row of manifests) {
    if (!row.decisionId) continue;
    addGroupedRow(manifestsByRef, correlationRefKey({
      gameId: row.gameId,
      ownerEpoch: row.ownerEpoch,
      decisionId: row.decisionId,
    }), row);
  }
  for (const row of cognition) {
    if (!row.decisionId) continue;
    addGroupedRow(cognitionByRef, cognitionRefKey({
      gameId: row.gameId,
      decisionId: row.decisionId,
    }), row);
  }
  for (const row of promptReuseSources) {
    addGroupedRow(promptReuseByRef, correlationRefKey(row), row);
  }

  return new Map(refs.map((ref) => [
    correlationRefKey(ref),
    {
      manifests: manifestsByRef.get(correlationRefKey(ref)) ?? [],
      cognition: cognitionByRef.get(cognitionRefKey(ref)) ?? [],
      promptReuseSources: promptReuseByRef.get(correlationRefKey(ref)) ?? [],
    },
  ]));
}

function rowStatus(
  ref: AcceptedActionDecisionRef,
  rows: CorrelationRows,
): CorrelationRowStatus {
  const missing: Array<"manifest" | "cognition"> = [];
  if (rows.manifests.length === 0) missing.push("manifest");
  if (rows.cognition.length === 0) missing.push("cognition");
  const manifestActionMismatch = rows.manifests.some(
    (row) => row.metadata.action !== ref.traceAction,
  );
  const cognitionActionMismatch = rows.cognition.some(
    (row) => row.action !== ref.traceAction,
  );
  const actionMismatchSources: Array<"manifest" | "cognition"> = [];
  if (manifestActionMismatch) actionMismatchSources.push("manifest");
  if (cognitionActionMismatch) actionMismatchSources.push("cognition");
  const actionMismatch = actionMismatchSources.length > 0;

  const manifestSequences = rows.manifests
    .map((row) => row.eventSequence)
    .filter((sequence): sequence is number => sequence !== null);
  const cognitionSequences = rows.cognition
    .map((row) => row.eventSequence)
    .filter((sequence): sequence is number => sequence !== null);
  const promptSequences = rows.promptReuseSources
    .map((row) => row.eventSequence)
    .filter((sequence) => sequence > 0);
  const conflictSequences = [...new Set([
    ...manifestSequences,
    ...cognitionSequences,
    ...promptSequences,
  ].filter((sequence) => sequence !== ref.eventSequence))].sort((a, b) => a - b);
  if (ref.canonicalConflict && conflictSequences.length === 0) {
    conflictSequences.push(ref.eventSequence);
  }

  const unresolved = (
    rows.manifests.some((row) => row.eventSequence === null)
    || rows.cognition.some((row) => row.eventSequence === null)
    || rows.promptReuseSources.some((row) => row.eventSequence === 0)
  );
  return {
    actionMismatch,
    actionMismatchSources,
    conflictSequences,
    missing,
    unresolved,
    linked: (
      !actionMismatch
      && conflictSequences.length === 0
      && missing.length === 0
      && !unresolved
    ),
  };
}

function diagnosticsForStatus(
  ref: AcceptedActionDecisionRef,
  status: CorrelationRowStatus,
): AcceptedActionCorrelationDiagnostic[] {
  const diagnostics: AcceptedActionCorrelationDiagnostic[] = [];
  if (status.missing.length > 0) {
    diagnostics.push({
      code: "accepted_action_private_capture_missing",
      decisionId: ref.decisionId,
      eventSequence: ref.eventSequence,
      missing: status.missing,
    });
  }
  if (status.conflictSequences.length > 0) {
    diagnostics.push({
      code: "accepted_action_correlation_conflict",
      decisionId: ref.decisionId,
      eventSequence: ref.eventSequence,
      conflictingSequences: status.conflictSequences,
    });
  }
  if (status.actionMismatch) {
    diagnostics.push({
      code: "accepted_action_trace_action_mismatch",
      decisionId: ref.decisionId,
      eventSequence: ref.eventSequence,
      expectedAction: ref.traceAction,
      mismatchedSources: status.actionMismatchSources,
    });
  }
  return diagnostics;
}

function emptyResult(eligibleDecisionCount: number): AcceptedActionCorrelationResult {
  return {
    eligibleDecisionCount,
    linkedDecisionCount: 0,
    unresolvedDecisionCount: 0,
    missingCaptureDecisionCount: 0,
    conflictDecisionCount: 0,
    updatedManifestCount: 0,
    updatedCognitiveArtifactCount: 0,
    updatedPromptReuseSourceCount: 0,
    diagnostics: [],
  };
}

export async function summarizeAcceptedActionCorrelations(
  db: CorrelationReadDB,
  persistedEvents: readonly TrustedPersistedGameEvent[],
): Promise<AcceptedActionCorrelationSummary> {
  const refs = acceptedActionDecisionRefs(persistedEvents);
  const summary = emptyResult(refs.length);
  const rowsByRef = await loadCorrelationRowsByRef(db, refs);

  for (const ref of refs) {
    const status = rowStatus(
      ref,
      rowsByRef.get(correlationRefKey(ref))!,
    );
    if (status.linked) summary.linkedDecisionCount += 1;
    if (status.unresolved) summary.unresolvedDecisionCount += 1;
    if (status.missing.length > 0) summary.missingCaptureDecisionCount += 1;
    if (status.conflictSequences.length > 0 || status.actionMismatch) {
      summary.conflictDecisionCount += 1;
    }
  }

  return {
    eligibleDecisionCount: summary.eligibleDecisionCount,
    linkedDecisionCount: summary.linkedDecisionCount,
    unresolvedDecisionCount: summary.unresolvedDecisionCount,
    missingCaptureDecisionCount: summary.missingCaptureDecisionCount,
    conflictDecisionCount: summary.conflictDecisionCount,
  };
}

export async function reconcileAcceptedActionCorrelations(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch: string;
  },
): Promise<AcceptedActionCorrelationResult> {
  const persisted = await getPersistedGameEvents(db, params.gameId);
  const refs = acceptedActionDecisionRefs(persisted.events, params.ownerEpoch);

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext('accepted_action_correlation'),
        hashtext(${params.ownerEpoch})
      )
    `);

    const result = emptyResult(refs.length);
    let promptReuseChanged = false;
    const rowsByRef = await loadCorrelationRowsByRef(tx, refs);

    for (const ref of refs) {
      const rows = rowsByRef.get(correlationRefKey(ref))!;
      const before = rowStatus(ref, rows);
      result.diagnostics.push(...diagnosticsForStatus(ref, before));
      if (before.missing.length > 0) result.missingCaptureDecisionCount += 1;
      if (before.conflictSequences.length > 0 || before.actionMismatch) {
        result.conflictDecisionCount += 1;
        if (before.unresolved) result.unresolvedDecisionCount += 1;
        continue;
      }
      if (rows.manifests.length === 0) {
        if (before.unresolved) result.unresolvedDecisionCount += 1;
        continue;
      }

      const changedManifestCount = rows.manifests.filter(
        (row) => row.eventSequence !== ref.eventSequence,
      ).length;
      if (changedManifestCount > 0) {
        await tx.update(schema.gameEvidenceManifests)
          .set({ eventSequence: ref.eventSequence })
          .where(and(
            eq(schema.gameEvidenceManifests.gameId, ref.gameId),
            eq(schema.gameEvidenceManifests.ownerEpoch, ref.ownerEpoch),
            eq(schema.gameEvidenceManifests.decisionId, ref.decisionId),
            eq(schema.gameEvidenceManifests.evidenceType, PRIVATE_TRACE_EVIDENCE_TYPE),
            isNull(schema.gameEvidenceManifests.eventSequence),
          ));
        result.updatedManifestCount += changedManifestCount;
      }

      const changedCognitionCount = rows.cognition.filter(
        (row) => row.eventSequence !== ref.eventSequence,
      ).length;
      if (changedCognitionCount > 0) {
        await tx.update(schema.gameCognitiveArtifacts)
          .set({ eventSequence: ref.eventSequence })
          .where(and(
            eq(schema.gameCognitiveArtifacts.gameId, ref.gameId),
            eq(schema.gameCognitiveArtifacts.decisionId, ref.decisionId),
            isNull(schema.gameCognitiveArtifacts.eventSequence),
          ));
        result.updatedCognitiveArtifactCount += changedCognitionCount;
      }

      const changedPromptReuseCount = rows.promptReuseSources.filter(
        (row) => row.eventSequence !== ref.eventSequence,
      ).length;
      if (changedPromptReuseCount > 0) {
        await tx.update(schema.gamePromptReuseAppliedSources)
          .set({ eventSequence: ref.eventSequence })
          .where(and(
            eq(schema.gamePromptReuseAppliedSources.gameId, ref.gameId),
            eq(schema.gamePromptReuseAppliedSources.ownerEpoch, ref.ownerEpoch),
            eq(schema.gamePromptReuseAppliedSources.decisionId, ref.decisionId),
            eq(schema.gamePromptReuseAppliedSources.eventSequence, 0),
          ));
        result.updatedPromptReuseSourceCount += changedPromptReuseCount;
        promptReuseChanged = true;
      }

      if (before.missing.length === 0) {
        result.linkedDecisionCount += 1;
      }
    }

    if (promptReuseChanged) {
      await rebuildPromptReuseRollupInTransaction(tx, params.gameId, params.ownerEpoch);
    }

    return result;
  });
}

async function markCorrelationDegraded(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  reason: string,
): Promise<void> {
  await db.update(schema.gameRunOwners)
    .set({
      kernelHealth: "degraded",
      failureReason: sql`
        CASE
          WHEN ${schema.gameRunOwners.failureReason} IS NULL
            OR ${schema.gameRunOwners.failureReason} LIKE 'accepted_action_correlation_failed:%'
          THEN ${`accepted_action_correlation_failed: ${reason}`}
          ELSE ${schema.gameRunOwners.failureReason}
        END
      `,
    })
    .where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
      eq(schema.gameRunOwners.status, "active"),
    ));
}

async function clearRecoveredCorrelationDegradation(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
): Promise<void> {
  await db.update(schema.gameRunOwners)
    .set({
      kernelHealth: "healthy",
      failureReason: null,
    })
    .where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
      eq(schema.gameRunOwners.status, "active"),
      like(schema.gameRunOwners.failureReason, "accepted_action_correlation_failed:%"),
    ));
}

export async function tryReconcileAcceptedActionCorrelations(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch: string;
  },
): Promise<NonfatalAcceptedActionCorrelationResult> {
  try {
    const result = await reconcileAcceptedActionCorrelations(db, params);
    if (result.diagnostics.length === 0) {
      await clearRecoveredCorrelationDegradation(
        db,
        params.gameId,
        params.ownerEpoch,
      ).catch(() => {});
    } else {
      const reason = [
        `${result.missingCaptureDecisionCount} missing capture`,
        `${result.conflictDecisionCount} conflict`,
      ].join(", ");
      await markCorrelationDegraded(
        db,
        params.gameId,
        params.ownerEpoch,
        reason,
      ).catch(() => {});
    }
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markCorrelationDegraded(
      db,
      params.gameId,
      params.ownerEpoch,
      message,
    ).catch(() => {});
    return { ok: false, error: message };
  }
}
