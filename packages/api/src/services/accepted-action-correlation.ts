import { and, eq, like, sql } from "drizzle-orm";
import {
  ACCEPTED_ACTION_REGISTRY,
  type CanonicalGameEvent,
  type CanonicalSourcePointer,
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
  eventType: CanonicalGameEvent["type"];
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
  conflictSequences: number[];
  missing: Array<"manifest" | "cognition">;
  unresolved: boolean;
  linked: boolean;
}

function readPath(value: unknown, path: string): unknown[] {
  const parts = path.split(".");
  let current: unknown[] = [value];
  for (const part of parts) {
    const arrayStep = part.endsWith("[]");
    const key = arrayStep ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const item of current) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const child = (item as Record<string, unknown>)[key];
      if (arrayStep) {
        if (Array.isArray(child)) next.push(...child);
      } else {
        next.push(child);
      }
    }
    current = next;
  }
  return current;
}

function pointerActorMatches(
  event: CanonicalGameEvent,
  pointer: CanonicalSourcePointer,
  actorPayloadPath: string | null,
): boolean {
  if (!pointer.actorId) return false;
  if (actorPayloadPath === null) return true;
  return readPath(event.payload, actorPayloadPath).includes(pointer.actorId);
}

function decisionPointersForEvent(event: CanonicalGameEvent): CanonicalSourcePointer[] {
  const registry = ACCEPTED_ACTION_REGISTRY[
    event.type as keyof typeof ACCEPTED_ACTION_REGISTRY
  ];
  if (!registry) return [];

  return event.sourcePointers.filter((pointer) => (
    pointer.kind === "agent_turn"
    && typeof pointer.decisionId === "string"
    && pointer.decisionId.length > 0
    && typeof pointer.action === "string"
    && (registry.sourceActions as readonly string[]).includes(pointer.action)
    && pointerActorMatches(event, pointer, registry.actorPayloadPath)
  ));
}

export function acceptedActionDecisionRefs(
  persistedEvents: readonly TrustedPersistedGameEvent[],
  ownerEpoch?: string,
): AcceptedActionDecisionRef[] {
  const refs = new Map<string, AcceptedActionDecisionRef>();

  for (const persisted of persistedEvents) {
    if (ownerEpoch && persisted.ownerEpoch !== ownerEpoch) continue;
    const pointers = decisionPointersForEvent(persisted.envelope);
    if (pointers.length === 0) continue;

    const registry = ACCEPTED_ACTION_REGISTRY[
      persisted.envelope.type as keyof typeof ACCEPTED_ACTION_REGISTRY
    ]!;
    const uniqueDecisionIds = [...new Set(pointers.map((pointer) => pointer.decisionId!))];
    const oneToOneConflict = registry.cardinality === "one_to_one"
      && uniqueDecisionIds.length > 1;

    for (const decisionId of uniqueDecisionIds) {
      const key = `${persisted.ownerEpoch}:${decisionId}`;
      const existing = refs.get(key);
      if (existing && existing.eventSequence !== persisted.sequence) {
        existing.canonicalConflict = true;
        continue;
      }
      refs.set(key, {
        gameId: persisted.gameId,
        ownerEpoch: persisted.ownerEpoch,
        decisionId,
        eventSequence: persisted.sequence,
        eventType: persisted.envelope.type,
        canonicalConflict: oneToOneConflict,
      });
    }
  }

  return [...refs.values()].sort((left, right) => (
    left.eventSequence - right.eventSequence
    || left.decisionId.localeCompare(right.decisionId)
  ));
}

async function loadCorrelationRows(
  db: CorrelationReadDB,
  ref: AcceptedActionDecisionRef,
): Promise<CorrelationRows> {
  const [manifests, cognition, promptReuseSources] = await Promise.all([
    db.select()
      .from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.gameId, ref.gameId),
        eq(schema.gameEvidenceManifests.ownerEpoch, ref.ownerEpoch),
        eq(schema.gameEvidenceManifests.decisionId, ref.decisionId),
        eq(schema.gameEvidenceManifests.evidenceType, PRIVATE_TRACE_EVIDENCE_TYPE),
      )),
    db.select()
      .from(schema.gameCognitiveArtifacts)
      .where(and(
        eq(schema.gameCognitiveArtifacts.gameId, ref.gameId),
        eq(schema.gameCognitiveArtifacts.decisionId, ref.decisionId),
      )),
    db.select()
      .from(schema.gamePromptReuseAppliedSources)
      .where(and(
        eq(schema.gamePromptReuseAppliedSources.gameId, ref.gameId),
        eq(schema.gamePromptReuseAppliedSources.ownerEpoch, ref.ownerEpoch),
        eq(schema.gamePromptReuseAppliedSources.decisionId, ref.decisionId),
      )),
  ]);

  return { manifests, cognition, promptReuseSources };
}

function rowStatus(
  ref: AcceptedActionDecisionRef,
  rows: CorrelationRows,
): CorrelationRowStatus {
  const missing: Array<"manifest" | "cognition"> = [];
  if (rows.manifests.length === 0) missing.push("manifest");
  if (rows.cognition.length === 0) missing.push("cognition");

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
    conflictSequences,
    missing,
    unresolved,
    linked: (
      conflictSequences.length === 0
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

  for (const ref of refs) {
    const status = rowStatus(ref, await loadCorrelationRows(db, ref));
    if (status.linked) summary.linkedDecisionCount += 1;
    if (status.unresolved) summary.unresolvedDecisionCount += 1;
    if (status.missing.length > 0) summary.missingCaptureDecisionCount += 1;
    if (status.conflictSequences.length > 0) summary.conflictDecisionCount += 1;
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

    for (const ref of refs) {
      const rows = await loadCorrelationRows(tx, ref);
      const before = rowStatus(ref, rows);
      result.diagnostics.push(...diagnosticsForStatus(ref, before));
      if (before.missing.length > 0) result.missingCaptureDecisionCount += 1;
      if (before.conflictSequences.length > 0) {
        result.conflictDecisionCount += 1;
        if (before.unresolved) result.unresolvedDecisionCount += 1;
        continue;
      }

      if (rows.manifests.length > 0) {
        await tx.update(schema.gameEvidenceManifests)
          .set({ eventSequence: ref.eventSequence })
          .where(and(
            eq(schema.gameEvidenceManifests.gameId, ref.gameId),
            eq(schema.gameEvidenceManifests.ownerEpoch, ref.ownerEpoch),
            eq(schema.gameEvidenceManifests.decisionId, ref.decisionId),
            eq(schema.gameEvidenceManifests.evidenceType, PRIVATE_TRACE_EVIDENCE_TYPE),
          ));
        result.updatedManifestCount += rows.manifests.filter(
          (row) => row.eventSequence !== ref.eventSequence,
        ).length;
      }

      if (rows.cognition.length > 0) {
        await tx.update(schema.gameCognitiveArtifacts)
          .set({ eventSequence: ref.eventSequence })
          .where(and(
            eq(schema.gameCognitiveArtifacts.gameId, ref.gameId),
            eq(schema.gameCognitiveArtifacts.decisionId, ref.decisionId),
          ));
        result.updatedCognitiveArtifactCount += rows.cognition.filter(
          (row) => row.eventSequence !== ref.eventSequence,
        ).length;
      }

      if (rows.promptReuseSources.length > 0) {
        await tx.update(schema.gamePromptReuseAppliedSources)
          .set({ eventSequence: ref.eventSequence })
          .where(and(
            eq(schema.gamePromptReuseAppliedSources.gameId, ref.gameId),
            eq(schema.gamePromptReuseAppliedSources.ownerEpoch, ref.ownerEpoch),
            eq(schema.gamePromptReuseAppliedSources.decisionId, ref.decisionId),
          ));
        const changedCount = rows.promptReuseSources.filter(
          (row) => row.eventSequence !== ref.eventSequence,
        ).length;
        result.updatedPromptReuseSourceCount += changedCount;
        promptReuseChanged ||= changedCount > 0;
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
