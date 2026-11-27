import { loadPayloads, storeFields } from "./payload-storage.js";
import { reserveInference, dispatchInference, recoverExpiredTextExecutions, settleInference } from "./inference-allowances.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { sha256StableJson } from "./stable-hash.js";
import { textProviderAttempts, type TextProviderAttempt } from "./text-provider-attempts.js";

import { GenerationAdmissionError } from "./generation-admission-error.js";
export { GenerationAdmissionError } from "./generation-admission-error.js";

/** One allowance reservation for a bounded text operation. SDK retries must be disabled. */
export async function runAccountText<T>(db: DrizzleDB, input: {
  userId: string; requestKey: string; kind: string; model: string; payload: unknown; attemptLimit?: 1 | 2;
}, run: (attempt: TextProviderAttempt) => Promise<T>): Promise<T> {
  if (!/^[\w:-]{1,160}$/.test(input.requestKey)) throw new GenerationAdmissionError("invalid_request_id", "A valid request ID is required.", 400);
  const table = schema.accountTextOperations;
  const inputHash = sha256StableJson({ kind: input.kind, payload: input.payload });
  const id = randomUUID();
  const inserted = await loadPayloads(db.transaction(async tx => {
    await recoverExpiredTextExecutions(tx, input.userId);
    const [row] = await loadPayloads(tx.insert(table).values({ id, userId: input.userId, requestKey: input.requestKey, kind: input.kind,
      model: input.model, inputHash }).onConflictDoNothing().returning());
    if (row) await reserveInference(tx,{id: `text:${id}`,userId:input.userId,category:'text',inputHash});
    return row;
  }));
  if (!inserted) {
    const [prior] = await loadPayloads(db.select().from(table).where(and(eq(table.userId, input.userId), eq(table.requestKey, input.requestKey))));
    if (!prior || prior.inputHash !== inputHash) throw new GenerationAdmissionError("request_conflict", "This request ID belongs to different input.");
    if (prior.state === "succeeded") return prior.result as T;
    if (prior.state === "failed") throw new GenerationAdmissionError("generation_failed","The previous generation failed. You can start a new attempt.");
    throw new GenerationAdmissionError("generation_recovery_required", "This generation is pending or needs recovery. Do not submit it again.");
  }
  const attempts = textProviderAttempts(input.attemptLimit ?? 1, async usage => {
    await db.update(table).set(usage).where(eq(table.id, id));
  });
  let dispatched = false;
  try {
    const value = await run(request => attempts.attempt(async () => {
      await db.transaction(async tx => {
        await dispatchInference(tx,`text:${id}`,input.userId);
        if (!dispatched)
          await tx.update(table).set({state:"dispatched"}).where(eq(table.id,id));
      });
      dispatched = true;
      return request();
    }));
    const accepted = await storeFields({ state: "succeeded" as const, result: value, completedAt: new Date().toISOString() }, {"result":"json-gzip"});
    const completed = await db.transaction(async tx => {
      await recoverExpiredTextExecutions(tx, input.userId);
      const [changed] = await tx.update(table).set(accepted)
        .where(and(eq(table.id, id), eq(table.state, "dispatched"))).returning({ id: table.id });
      if (!changed) return false;
      await settleInference(tx,`text:${id}`,input.userId,'succeeded');
      return true;
    });
    if (!completed) throw new GenerationAdmissionError("generation_failed", "The generation was interrupted. Try again.");
    return value;
  } catch (error) {
    const state = dispatched && attempts.uncertain ? "uncertain" : "failed";
    await db.transaction(async tx => {
      await recoverExpiredTextExecutions(tx, input.userId);
      const [changed] = await tx.update(table).set({
        state: "failed", failedBeforeDispatch: !dispatched, completedAt: new Date().toISOString(),
      }).where(and(eq(table.id, id), eq(table.state, dispatched ? "dispatched" : "reserved"))).returning({ id: table.id });
      if (!changed) return;
      await settleInference(tx,`text:${id}`,input.userId,state);
    });
    throw error;
  }
}
