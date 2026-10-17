import { loadPayloads, storeFields } from "./payload-storage.js";
import { APIError } from "openai";
import { reserveInference, dispatchInference, settleInference } from "./inference-allowances.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { estimateCostForKnownModel, MODEL_PRICING } from "@influence/engine";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { schema, type DrizzleDB } from "../db/index.js";
import { sha256StableJson } from "./stable-hash.js";

import { GenerationAdmissionError } from "./generation-admission-error.js";
export { GenerationAdmissionError } from "./generation-admission-error.js";

/** One bounded provider attempt per text operation; SDK retries must be disabled. */
export async function runAccountText<T>(db: DrizzleDB, input: {
  userId: string; requestKey: string; kind: string; model: string; payload: unknown;
}, run: (record: (response: ChatCompletion) => Promise<void>) => Promise<T>): Promise<T> {
  if (!/^[\w:-]{1,160}$/.test(input.requestKey)) throw new GenerationAdmissionError("invalid_request_id", "A valid request ID is required.", 400);
  const table = schema.accountTextOperations;
  const inputHash = sha256StableJson({ kind: input.kind, payload: input.payload });
  const id = randomUUID();
  const inserted = await loadPayloads(db.transaction(async tx => {
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
  let responseObserved = false;
  let dispatched = false;
  try {
    await db.transaction(async tx => {
      await dispatchInference(tx,`text:${id}`,input.userId);
      await tx.update(table).set(await storeFields({state:'dispatched'}, {"result":"json-gzip"})).where(eq(table.id,id));
    });
    dispatched = true;
    const value = await run(async response => {
      responseObserved = true;
      const usage = response.usage;
      const cost = usage ? estimateCostForKnownModel({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0, reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        totalTokens: usage.total_tokens, callCount: 1, emptyResponses: 0 }, response.model) : null;
      await db.update(table).set(await storeFields({ promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens,
        model: response.model, providerRequestId: response.id, estimatedCostMicrousd: cost ? Math.round(cost.totalCost * 1_000_000) : null,
        pricingSource: cost ? `engine.MODEL_PRICING:${sha256StableJson(MODEL_PRICING[response.model])}` : null }, {"result":"json-gzip"})).where(eq(table.id, id));
    });
    await db.transaction(async tx => {
      await settleInference(tx,`text:${id}`,input.userId,'succeeded');
      await tx.update(table).set(await storeFields({ state: "succeeded", result: value, completedAt: new Date().toISOString() }, {"result":"json-gzip"})).where(eq(table.id, id));
    });
    return value;
  } catch (error) {
    const state = responseObserved || !dispatched || error instanceof GenerationAdmissionError || (error instanceof APIError && error.status !== undefined) ? 'failed' : 'uncertain';
    await db.transaction(async tx => {
      await settleInference(tx,`text:${id}`,input.userId,state);
      await tx.update(table).set(await storeFields({state,result:{failure:{beforeDispatch:!dispatched || error instanceof GenerationAdmissionError}},completedAt:state==='failed'?new Date().toISOString():null}, {"result":"json-gzip"})).where(eq(table.id,id));
    });
    throw error;
  }
}
