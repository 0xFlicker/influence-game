import { createHash, randomUUID } from "node:crypto";
import { and, eq, getTableColumns } from "drizzle-orm";
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
export async function reserveVisualRender(db: DrizzleDB, gameId: string, operationKey: string, request: VisualImageRequest): Promise<Operation> {
  const inputHash = hash(stableJson({ ...request, references: request.references.map(hash) }));
  return reserveVisualOperation(db, gameId, operationKey, inputHash);
}

async function reserveVisualOperation(db: DrizzleDB, gameId: string, operationKey: string, inputHash: string): Promise<Operation> {
  if (!operationKey.trim()) throw new Error("A visual operation needs a stable operation key");
  await db.insert(operations).values({ id: randomUUID(), gameId, operationKey, inputHash }).onConflictDoNothing();
  const [operation] = await db.select().from(operations).where(and(eq(operations.gameId, gameId), eq(operations.operationKey, operationKey)));
  if (!operation || operation.inputHash !== inputHash) throw new Error("Visual operation inputs changed at an existing boundary");
  return operation;
}

/** No transaction is held while either image provider runs. */
export async function renderDurableVisualImage(db: DrizzleDB, input: {
  gameId: string; operationKey: string; request: VisualImageRequest; signal?: AbortSignal;
}) {
  const operation = await reserveVisualRender(db, input.gameId, input.operationKey, input.request);
  const prior = await db.select().from(attempts).where(and(eq(attempts.operationId, operation.id), eq(attempts.generation, operation.generation)));
  const completed = prior.find((entry) => entry.image !== null && entry.receipt !== null);
  if (completed?.image && completed.receipt) return { image: completed.image, receipt: completed.receipt };
  if (prior.length) throw new VisualRenderRecoveryRequired(operation.id, "Visual rendering needs recovery before another paid request");
  return generateVisualImage(input.request, visualImageJournal(db, operation), input.signal);
}

/** Attempt identity and generation fence both reservation and completion. */
export function visualImageJournal(db: DrizzleDB, operation: Operation): VisualImageJournal {
  return {
    async begin(input) {
      await db.transaction(async (tx) => {
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
      });
    },
    async finish(receipt, image, localization) {
      if (image && localization) throw new Error("A visual attempt cannot contain two output types");
      const imageHash = image ? hash(image) : null;
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(operations).where(eq(operations.id, operation.id)).for("update");
        if (!current || current.generation !== operation.generation) throw new Error("Stale visual render completion");
        const [entry] = await tx.select().from(attempts).where(and(eq(attempts.operationId, operation.id), eq(attempts.generation, operation.generation), eq(attempts.provider, receipt.provider)));
        if (!entry || entry.requestHash !== receipt.requestHash || entry.model !== receipt.model) throw new Error("Visual receipt does not match its reservation");
        if ((image || localization) && (receipt.chargeUncertain || receipt.status === null || receipt.status < 200 || receipt.status >= 300)) throw new Error("An unsuccessful receipt cannot carry accepted visual output");
        if (entry.finishedAt) {
          if (entry.imageHash === imageHash && stableJson(entry.receipt) === stableJson(receipt)
            && stableJson(entry.localization) === stableJson(localization ?? null)) return;
          throw new Error("Conflicting visual render completion");
        }
        if (entry.reconciliation) throw new Error("Visual attempt was already reconciled");
        await tx.update(attempts).set({ receipt, image: image ? Buffer.from(image) : null, imageHash, localization: localization ?? null, finishedAt: new Date().toISOString() }).where(eq(attempts.id, entry.id));
      });
    },
  };
}

function isAvailabilityFailure(receipt: VisualImageReceipt): boolean {
  return receipt.status === null || receipt.status === 429 || receipt.status >= 500 && receipt.status <= 599;
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
    await tx.update(attempts).set({ costMicrousd: input.costMicrousd, reconciliation: {
      operatorId: input.operatorId, note: input.note, at: new Date().toISOString(),
    } }).where(eq(attempts.id, entry.id));
  });
}

export async function readVisualRenderAccounting(db: DrizzleDB, gameId: string) {
  const { image: _image, ...receiptColumns } = getTableColumns(attempts);
  const rows = await db.select({ attempt: receiptColumns }).from(attempts).innerJoin(operations, eq(attempts.operationId, operations.id)).where(eq(operations.gameId, gameId));
  return {
    knownCostMicrousd: rows.reduce((sum, { attempt }) => sum + (attempt.costMicrousd ?? 0), 0),
    unpricedAttempts: rows.filter(({ attempt }) => attempt.costMicrousd === null).length,
    uncertainAttempts: rows.filter(({ attempt }) => unresolved(attempt)).length,
    attempts: rows.map(({ attempt }) => attempt),
  };
}

/** Image and identity references are hashed into the same durable request boundary. */
export async function localizeDurableVisualScene(db: DrizzleDB, input: {
  gameId: string; operationKey: string; scene: Uint8Array;
  references: readonly import("./visual-scene-localization.js").VisualReferenceImage[];
  apiKey: string; signal?: AbortSignal;
}) {
  const inputHash = hash(stableJson({ task: "localize-final-scene-v1", scene: hash(input.scene),
    references: input.references.map((reference) => ({ image: hash(reference.image), players: reference.players })),
  }));
  const operation = await reserveVisualOperation(db, input.gameId, input.operationKey, inputHash);
  const prior = await db.select().from(attempts).where(and(eq(attempts.operationId, operation.id), eq(attempts.generation, operation.generation)));
  const completed = prior.find((entry) => entry.localization !== null && entry.receipt !== null);
  if (completed?.localization) return completed.localization;
  if (prior.length) throw new VisualRenderRecoveryRequired(operation.id, "Scene localization needs recovery before another paid request");
  const { localizeVisualScene } = await import("./visual-scene-localization.js");
  return localizeVisualScene({ ...input, journal: visualImageJournal(db, operation) });
}
