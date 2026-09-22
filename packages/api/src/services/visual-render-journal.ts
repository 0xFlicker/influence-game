import { checkAvatarGenerationQuota } from "./avatar-generation.js";
import { recordVisualOperationEvent, visualFailureEvidence } from "./visual-diagnostics.js";
import { VisualIdentityFailure } from "@influence/engine/visual-localization";
import { VISUAL_LOCALIZATION_VERSION } from "./visual-scene-localization.js";
import { visualReceiptCostMicrousd } from "./visual-pricing.js";
import type { VisualBoundaryGuard } from "./visual-execution-boundary.js";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { stableJson } from "./stable-hash.js";
import { generateVisualImage, type VisualImageJournal, type VisualImageReceipt, type VisualImageRequest } from "./visual-image-provider.js";

const operations = schema.visualRenderOperations;
const attempts = schema.visualRenderAttempts;
type Operation = typeof operations.$inferSelect;
type Attempt = typeof attempts.$inferSelect;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export class VisualRenderRecoveryRequired extends Error {
  constructor(readonly operationId: string, message: string) {
    super(message);
    this.name = "VisualRenderRecoveryRequired";
  }
}

/** Immutable operation inputs make scratch-turn replay safe before scene publication. */
export async function reserveVisualRender(db: DrizzleDB, gameId: string, operationKey: string, request: VisualImageRequest, sceneId?: string): Promise<Operation> {
  const inputHash = hash(stableJson({ ...request, references: request.references.map(hash) }));
  return reserveVisualOperation(db, gameId, operationKey, inputHash, undefined, { ...request, references: request.references.map(hash) }, sceneId);
}

async function reserveVisualOperation(db: Pick<DrizzleDB, "select" | "insert">, gameId: string | null, operationKey: string, inputHash: string, userId?: string, request?: Record<string, unknown>, sceneId?: string): Promise<Operation> {
  if (!operationKey.trim()) throw new Error("A visual operation needs a stable operation key");
  await db.insert(operations).values({ id: randomUUID(), gameId, userId, operationKey, inputHash, request, sceneId }).onConflictDoNothing();
  const [operation] = await db.select().from(operations).where(and(gameId ? eq(operations.gameId, gameId) : eq(operations.userId, userId!), eq(operations.operationKey, operationKey)));
  if (!operation || operation.inputHash !== inputHash) throw new Error("Visual operation inputs changed at an existing boundary");
  return operation;
}

/** No transaction is held while either image provider runs. */
export async function renderDurableVisualImage(db: DrizzleDB, input: {
  gameId: string; operationKey: string; request: VisualImageRequest; signal?: AbortSignal; allowFallback?: boolean; sceneId?: string;
  beforeDispatch?: VisualBoundaryGuard;
}) {
  const operation = await reserveVisualRender(db, input.gameId, input.operationKey, input.request, input.sceneId);
  const prior = await db.select().from(attempts).where(and(eq(attempts.operationId, operation.id), eq(attempts.generation, operation.generation)));
  const completed = prior.find((entry) => entry.image !== null && entry.receipt !== null);
  if (completed?.image && completed.receipt) return { image: completed.image, receipt: completed.receipt };
  if (prior.length) throw new VisualRenderRecoveryRequired(operation.id, "Visual rendering needs recovery before another paid request");
  return generateVisualImage(input.request, visualImageJournal(db, operation, input.beforeDispatch), input.signal, input.allowFallback);
}

/** Attempt identity and generation fence both reservation and completion. */
export function visualImageJournal(db: DrizzleDB, operation: Operation, beforeDispatch?: VisualBoundaryGuard): VisualImageJournal {
  return {
    async begin(input) {
      await beforeDispatch?.();
      await db.transaction(async (tx) => {
        await beforeDispatch?.(tx);
        if (operation.sceneId && input.provider === "xai") {
          const [scene] = await tx.select().from(schema.visualScenes).where(eq(schema.visualScenes.id, operation.sceneId)).for("update");
          if (!scene || scene.status !== "preparing" || scene.repairBudgetUsed) throw new VisualRenderRecoveryRequired(operation.id, "Scene repair budget already consumed");
          await tx.update(schema.visualScenes).set({ repairBudgetUsed: true }).where(eq(schema.visualScenes.id, scene.id));
        }
        const [current] = await tx.select().from(operations).where(eq(operations.id, operation.id)).for("update");
        if (!current || current.generation !== operation.generation) throw new Error("Stale visual render generation");
        const prior = await tx.select().from(attempts).where(and(eq(attempts.operationId, operation.id), eq(attempts.generation, operation.generation)));
        // xAI is allowed only after a recorded OpenAI availability failure.
        const primary = prior.find((entry) => entry.provider === "openai");
        if (prior.some((entry) => entry.provider === input.provider || entry.image !== null || entry.localization !== null)
          || (input.provider === "openai" && prior.length > 0)
          || (input.provider === "xai" && (!primary?.receipt || !isAvailabilityFailure(primary.receipt)))) {
          throw new VisualRenderRecoveryRequired(operation.id, "Visual request already dispatched or fallback is not permitted");
        }
        await tx.insert(attempts).values({ id: randomUUID(), operationId: operation.id, generation: operation.generation, ...input });
        if (operation.gameId) await recordVisualOperationEvent(tx, operation.gameId, `${operation.id}:${operation.generation}:${input.provider}:started`, {
          operationId: operation.id, sceneId: operation.sceneId, kind: "attempt_started", outcome: "pending", message: `${input.provider} ${input.model}: ${operation.operationKey}`,
        });
      });
    },
    async finish(receipt, image, localization) {
      if (image && localization) throw new Error("A visual attempt cannot contain two output types");
      const imageHash = image ? hash(image) : null;
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(operations).where(eq(operations.id, operation.id)).for("update");
        if (!current) throw new Error("Visual render operation disappeared before completion");
        const [entry] = await tx.select().from(attempts).where(and(eq(attempts.operationId, operation.id), eq(attempts.generation, operation.generation), eq(attempts.provider, receipt.provider)));
        if (!entry || entry.requestHash !== receipt.requestHash || entry.model !== receipt.model) throw new Error("Visual receipt does not match its reservation");
        if ((image || localization) && (receipt.chargeUncertain || receipt.status === null || receipt.status < 200 || receipt.status >= 300)) throw new Error("An unsuccessful receipt cannot carry accepted visual output");
        if (entry.finishedAt) {
          if (entry.imageHash === imageHash && stableJson(entry.receipt) === stableJson(receipt)
            && stableJson(entry.localization) === stableJson(localization ?? null)) return;
          throw new Error("Conflicting visual render completion");
        }
        await tx.update(attempts).set({ receipt, costMicrousd: entry.reconciliation ? entry.costMicrousd : visualReceiptCostMicrousd(receipt), image: image ? Buffer.from(image) : null, imageHash, localization: localization ?? null, finishedAt: new Date().toISOString() }).where(eq(attempts.id, entry.id));
        if (operation.gameId) await recordVisualOperationEvent(tx, operation.gameId, `${entry.id}:finished`, {
          operationId: operation.id, sceneId: operation.sceneId, kind: "attempt_finished", outcome: receipt.chargeUncertain ? "uncertain" : receipt.failure ? "failed" : image || localization ? "success" : "failed",
          message: `${current.generation !== operation.generation || entry.reconciliation ? "Late completion retained for accounting; no scene publication. " : ""}${receipt.failure?.message ?? `${receipt.provider} HTTP ${receipt.status ?? "unknown"}`}`,
        }, receipt.failure);
      });
    },
  };
}

function isAvailabilityFailure(receipt: VisualImageReceipt): boolean {
  return receipt.status === 429 || receipt.status !== null && receipt.status >= 500 && receipt.status <= 599;
}
function unresolved(entry: Pick<Attempt, "receipt" | "reconciliation">): boolean {
  return !entry.reconciliation && (!entry.receipt || entry.receipt.chargeUncertain);
}

/** Explicit operator recovery, never an automatic timeout retry. Historical attempts remain intact. */
export async function retryVisualRender(db: DrizzleDB, operationId: string, expectedGeneration: number): Promise<Operation> {
  return db.transaction(async (tx) => {
    const [operation] = await tx.select().from(operations).where(eq(operations.id, operationId)).for("update");
    if (!operation || operation.generation !== expectedGeneration) throw new Error("Visual retry generation changed");
    const prior = await tx.select().from(attempts).where(eq(attempts.operationId, operationId));
    if (prior.some(unresolved)) throw new VisualRenderRecoveryRequired(operationId, "Reconcile uncertain paid attempts before retrying");
    const current = prior.filter((entry) => entry.generation === expectedGeneration);
    if (!current.length || current.some((entry) => entry.image !== null || entry.localization !== null)) throw new Error("Only a failed visual render can be retried");
    const [next] = await tx.update(operations).set({ generation: expectedGeneration + 1 }).where(eq(operations.id, operationId)).returning();
    return next!;
  });
}

/** Records externally established accounting; it does not assert a missing request was free. */
export async function reconcileVisualAttempt(db: DrizzleDB, input: {
  attemptId: string; operatorId: string; note: string; costMicrousd: number;
}): Promise<void> {
  if (!input.operatorId.trim() || !input.note.trim() || !Number.isSafeInteger(input.costMicrousd) || input.costMicrousd < 0) throw new Error("Visual reconciliation requires an operator, evidence and a nonnegative cost");
  await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(attempts).where(eq(attempts.id, input.attemptId));
    if (!entry) throw new Error("Visual attempt not found");
    // Lock order matches begin/finish/retry so concurrent completion cannot be overwritten.
    await tx.select().from(operations).where(eq(operations.id, entry.operationId)).for("update");
    const [current] = await tx.select().from(attempts).where(eq(attempts.id, entry.id));
    if (!current || current.reconciliation) throw new Error("Visual attempt already reconciled");
    const [operation] = await tx.select().from(operations).where(eq(operations.id, entry.operationId));
    if (operation?.gameId) await recordVisualOperationEvent(tx, operation.gameId, `${entry.id}:reconciled`, { operationId: operation.id, kind: "reconciliation", outcome: "success", message: `${input.operatorId}: ${input.note}; confirmed cost ${input.costMicrousd} micro-USD` });
    await tx.update(attempts).set({ costMicrousd: input.costMicrousd, reconciliation: {
      operatorId: input.operatorId, note: input.note, at: new Date().toISOString(),
    } }).where(eq(attempts.id, entry.id));
  });
}

export async function readVisualRenderAccounting(db: DrizzleDB, gameId: string) {
  const { image: _image, ...receiptColumns } = getTableColumns(attempts);
  const rows = await db.select({ attempt: receiptColumns, operation: operations }).from(attempts).innerJoin(operations, eq(attempts.operationId, operations.id)).where(eq(operations.gameId, gameId));
  return {
    knownCostMicrousd: rows.reduce((sum, { attempt }) => sum + (attempt.costMicrousd ?? 0), 0),
    unpricedAttempts: rows.filter(({ attempt }) => attempt.costMicrousd === null).length,
    uncertainAttempts: rows.filter(({ attempt }) => unresolved(attempt)).length,
    attempts: rows.map(({ attempt, operation }) => ({ ...attempt, operationKey: operation.operationKey, sceneId: operation.sceneId, request: operation.request, inputHash: operation.inputHash })),
  };
}

/** Image and identity references are hashed into the same durable request boundary. */
export async function localizeDurableVisualScene(db: DrizzleDB, input: Parameters<typeof runDurableLocalization>[1] & { gameId: string }) {
  const composition = await runDurableLocalization(db, { ...input, operationKey: `${input.operationKey}:composition`, compositionOnly: true });
  let geometry;
  try { geometry = await runDurableLocalization(db, input); }
  catch (error) {
    if (error instanceof VisualIdentityFailure || input.signal?.aborted) throw error;
    await recordVisualOperationEvent(db, input.gameId, `${input.operationKey}:unanchored`, { kind: "presentation", outcome: "unanchored", message: "Identities verified; head coordinates unavailable. Use a named speech panel." }, visualFailureEvidence(error, "anchors"));
    return composition;
  }
  const matched = await runDurableLocalization(db, { ...input, operationKey: `${input.operationKey}:identities`, candidateAnchors: geometry.anchors });
  return { ...matched, verifiedParticipantIds: composition.verifiedParticipantIds };
}

async function runDurableLocalization(db: DrizzleDB, input: {
  gameId: string | null; userId?: string; operationKey: string; scene: Uint8Array; sceneId?: string;
  references: readonly import("./visual-scene-localization.js").VisualReferenceImage[];
  apiKey: string; signal?: AbortSignal;
  beforeDispatch?: VisualBoundaryGuard;
  compositionOnly?: boolean;
  candidateAnchors?: readonly import("@influence/engine/visual-mode").VisualPlayerAnchor[];
}) {
  const inputHash = hash(stableJson({ task: VISUAL_LOCALIZATION_VERSION, compositionOnly: input.compositionOnly === true, ...(input.candidateAnchors && { candidates: input.candidateAnchors }), scene: hash(input.scene),
    references: input.references.map((reference) => ({ image: hash(reference.image), players: reference.players })),
  }));
  const operation = await reserveVisualOperation(db, input.gameId, input.operationKey, inputHash, input.userId, {
    task: VISUAL_LOCALIZATION_VERSION, compositionOnly: input.compositionOnly === true,
    sceneHash: hash(input.scene), candidates: input.candidateAnchors ?? null,
    references: input.references.map((reference) => ({ imageHash: hash(reference.image), players: reference.players })),
  }, input.sceneId);
  const prior = await db.select().from(attempts).where(and(eq(attempts.operationId, operation.id), eq(attempts.generation, operation.generation)));
  const completed = prior.find((entry) => entry.localization !== null && entry.receipt !== null);
  if (completed?.localization) return completed.localization;
  if (prior.length) throw new VisualRenderRecoveryRequired(operation.id, "Scene localization needs recovery before another paid request");
  const { localizeVisualScene } = await import("./visual-scene-localization.js");
  return localizeVisualScene({ ...input, journal: visualImageJournal(db, operation, input.beforeDispatch) });
}

/** Draft references are owned by the authenticated account, before a game exists. */
export async function renderOwnedVisualReference(db: DrizzleDB, input: {
  userId: string; requestId: string; request: VisualImageRequest;
}) {
  const inputHash = hash(stableJson({ ...input.request, references: input.request.references.map(hash) }));
  const operation = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
    const [existing] = await tx.select().from(operations).where(and(eq(operations.userId, input.userId), eq(operations.operationKey, `full-body:${input.requestId}`)));
    if (!existing) {
      const quota = await checkAvatarGenerationQuota(tx, input.userId, undefined, {});
      if (!quota.ok) throw new Error(quota.message);
    }
    return reserveVisualOperation(tx, null, `full-body:${input.requestId}`, inputHash, input.userId);
  });
  const prior = await db.select().from(attempts).where(and(eq(attempts.operationId, operation.id), eq(attempts.generation, operation.generation)));
  const completed = prior.find((entry) => entry.image !== null && entry.receipt !== null);
  if (completed?.image) return { operationId: operation.id, image: completed.image };
  if (prior.length) throw new VisualRenderRecoveryRequired(operation.id, "Reference generation needs operator reconciliation before another paid request");
  const result = await generateVisualImage(input.request, visualImageJournal(db, operation));
  return { operationId: operation.id, image: result.image };
}

/** Best-effort shared asset generation, with a durable two-dispatch ceiling. */
export async function renderVisualAssetBestEffort(db: DrizzleDB, input: Parameters<typeof renderDurableVisualImage>[1]) {
  const operation = await reserveVisualRender(db, input.gameId, input.operationKey, input.request, input.sceneId);
  const prior = await db.select().from(attempts).where(eq(attempts.operationId, operation.id));
  const completed = prior.find((entry) => entry.image !== null && entry.receipt !== null);
  if (completed?.image && completed.receipt) return { image: completed.image, receipt: completed.receipt };
  const budgetAttempts = prior.filter((entry) => entry.generation >= operation.budgetStartGeneration);
  if (prior.some(unresolved) || budgetAttempts.length >= 2) return null;
  try {
    if (budgetAttempts.some((entry) => entry.generation === operation.generation)) await retryVisualRender(db, operation.id, operation.generation);
    return await renderDurableVisualImage(db, { ...input, allowFallback: budgetAttempts.length === 0 });
  } catch (error) {
    await recordVisualOperationEvent(db, input.gameId, `${operation.id}:${operation.generation}:asset-failure`, { operationId: operation.id, kind: "failure", outcome: "failed", message: "Asset generation failed" }, visualFailureEvidence(error, "internal"));
    const after = await db.select().from(attempts).where(eq(attempts.operationId, operation.id));
    if (after.filter((entry) => entry.generation >= operation.budgetStartGeneration).length === 1 && !after.some(unresolved)) {
      await retryVisualRender(db, operation.id, operation.generation);
      try { return await renderDurableVisualImage(db, { ...input, allowFallback: false }); }
      catch (repairError) { await recordVisualOperationEvent(db, input.gameId, `${operation.id}:${operation.generation}:asset-repair-failure`, { operationId: operation.id, kind: "failure", outcome: "failed", message: "Asset repair failed; use portrait or room description" }, visualFailureEvidence(repairError, "internal")); }
    }
    return null;
  }
}

/** A single-character head observation; shares durable receipts without scene/game authority. */
export async function localizeOwnedVisualReference(db: DrizzleDB, input: { userId: string; requestId: string; scene: Uint8Array; apiKey: string }) {
  return runDurableLocalization(db, { ...input, gameId: null, operationKey: `portrait-head:${VISUAL_LOCALIZATION_VERSION}:${input.requestId}`,
    references: [{ image: input.scene, players: [{ id: "character", name: "Character" }] }],
  });
}
